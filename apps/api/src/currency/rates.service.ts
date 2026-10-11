import { type Db, Prisma, RateSource } from "@crm/db";
import {
	CURRENCY_CODES,
	isCurrencyCode,
	normalizeCurrency,
} from "@crm/db/currency";
import {
	readRatesRefreshedAt,
	readReportingCurrency,
	writeRatesRefreshedAt,
} from "@crm/db/settings";
import type { Pramaan } from "@crm/pramaan";
import { idempotencyKey } from "@crm/pramaan";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { InjectPramaan } from "../pramaan/pramaan.constants";

export const RATES_SOURCE = "pramaan";

export interface RateRefresh {
	ok: boolean;
	base: string;
	written: number;
	asOf: string | null;
	reason: string | null;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class RatesService {
	private readonly logger = new Logger(RatesService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@InjectPramaan() private readonly pramaan: Pramaan | null,
	) {}

	async refreshedAt(): Promise<Date | null> {
		return readRatesRefreshedAt(this.db);
	}

	async refresh(): Promise<RateRefresh> {
		const base = await readReportingCurrency(this.db);

		if (!this.pramaan) {
			return {
				ok: false,
				base,
				written: 0,
				asOf: null,
				reason:
					"Pramaan is not configured, so live rates are off. Rates entered by hand are unaffected.",
			};
		}

		const quotes = await this.fetch(this.pramaan, base);

		if (!quotes) {
			return {
				ok: false,
				base,
				written: 0,
				asOf: null,
				reason:
					"Could not reach the exchange-rate capability. Rates entered by hand are unaffected.",
			};
		}

		const written = await this.store(base, quotes.rates, quotes.asOf);

		await writeRatesRefreshedAt(this.db, new Date());

		this.logger.log({
			message: "Exchange rates refreshed",
			base,
			written,
			asOf: quotes.asOf.toISOString(),
		});

		return {
			ok: true,
			base,
			written,
			asOf: quotes.asOf.toISOString(),
			reason: null,
		};
	}

	private async store(
		base: string,
		rates: Map<string, Prisma.Decimal>,
		asOf: Date,
	): Promise<number> {
		let written = 0;

		for (const [quoteCurrency, rate] of rates) {
			await this.db.exchangeRate.upsert({
				where: {
					baseCurrency_quoteCurrency_source: {
						baseCurrency: base,
						quoteCurrency,
						source: RateSource.FETCHED,
					},
				},
				create: {
					baseCurrency: base,
					quoteCurrency,
					rate,
					asOf,
					source: RateSource.FETCHED,
					provider: RATES_SOURCE,
				},
				update: { rate, asOf, provider: RATES_SOURCE },
			});

			written += 1;
		}

		const supported = [...CURRENCY_CODES];

		const stale = await this.db.exchangeRate.deleteMany({
			where: {
				source: RateSource.FETCHED,
				OR: [
					{ baseCurrency: { notIn: supported } },
					{ quoteCurrency: { notIn: supported } },
				],
			},
		});

		if (stale.count > 0) {
			this.logger.log({
				message: "Dropped fetched rates for currencies that are not supported",
				base,
				dropped: stale.count,
			});
		}

		return written;
	}

	/** One call per quote currency: how many base units one unit of the quote buys. */
	private async fetch(
		api: Pramaan,
		base: string,
	): Promise<{ rates: Map<string, Prisma.Decimal>; asOf: Date } | null> {
		const rates = new Map<string, Prisma.Decimal>();
		let newest = new Date(0);

		const quotes = CURRENCY_CODES.filter(
			(code) => normalizeCurrency(code) !== normalizeCurrency(base),
		);

		const answers = await Promise.all(
			quotes.map(async (quote) => {
				try {
					return {
						quote,
						answer: await api.exchangeRate(
							{ from: quote, to: base },
							{ idempotencyKey: idempotencyKey() },
						),
					};
				} catch (error) {
					this.logger.warn({
						message: "Exchange rate request failed",
						base,
						quote,
						reason: error instanceof Error ? error.message : String(error),
					});
					return null;
				}
			}),
		);

		for (const entry of answers) {
			if (!entry) continue;

			const perQuote =
				entry.answer.rate ??
				(entry.answer.inverseRate > 0
					? 1 / entry.answer.inverseRate
					: Number.NaN);

			if (!Number.isFinite(perQuote) || perQuote <= 0) continue;

			rates.set(
				normalizeCurrency(entry.quote),
				new Prisma.Decimal(perQuote).toDecimalPlaces(10),
			);

			if (entry.answer.date) {
				const asOf = new Date(entry.answer.date);
				if (!Number.isNaN(asOf.getTime()) && asOf > newest) newest = asOf;
			}
		}

		if (rates.size === 0) {
			this.logger.warn({
				message: "Exchange rates unavailable",
				base,
			});
			return null;
		}

		return { rates, asOf: newest.getTime() > 0 ? newest : new Date() };
	}
}
