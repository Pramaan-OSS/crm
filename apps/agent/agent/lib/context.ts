// Company and page context, answered through Pramaan: a company profile from its domain,
// structured facts from one page, and web search. This module replaces the old vendor client;
// the shapes it hands back are kept, so its callers read the same as before.

import type { Caps } from "@crm/pramaan";
import { z } from "zod";
import { CONTEXT } from "./context-config";
import { pramaan } from "./pramaan";

export type JsonSchema = {
	type?:
		| "array"
		| "boolean"
		| "integer"
		| "null"
		| "number"
		| "object"
		| "string";
	description?: string;
	properties?: Record<string, JsonSchema>;
	items?: JsonSchema;
	required?: string[];
	enum?: (string | number | boolean | null)[];
	additionalProperties?: boolean | JsonSchema;
};

/** The company facts a lookup can fill. Thinner than it used to be: one logo, no palette. */
export type Brand = {
	domain?: string | null;
	title?: string | null;
	description?: string | null;
	logoUrl?: string | null;
	industry?: string | null;
	city?: string | null;
	region?: string | null;
	country?: string | null;
	linkedinUrl?: string | null;
	websiteUrl?: string | null;
	employeeCount?: number | null;
	foundedYear?: number | null;
};

export type LookupResult =
	| { outcome: "found"; brand: Brand; raw: unknown }
	| { outcome: "skipped"; reason: string }
	| { outcome: "failed"; reason: string; retryable: boolean };

export type SearchResult = {
	url: string | null;
	title: string | null;
	description: string | null;
	markdown: string | null;
};

export function contextEnabled(): boolean {
	return pramaan() !== null;
}

export async function brandByDomain(
	domain: string,
	_maxAgeMs?: number,
): Promise<LookupResult> {
	const api = pramaan();
	if (!api) {
		return { outcome: "skipped", reason: "Pramaan is not configured." };
	}

	try {
		const response = await api.companiesEnrich({ domain });
		const brand = brandFrom(response);
		if (!brand) return { outcome: "skipped", reason: "No brand matched." };

		return { outcome: "found", brand, raw: response };
	} catch (error) {
		return classify(error);
	}
}

function brandFrom(response: Caps.CompaniesEnrichResult): Brand | null {
	const name = response.name?.trim();
	if (!name) return null;

	return {
		domain: response.domain ?? null,
		title: name,
		description: response.description ?? null,
		logoUrl: response.logoUrl ?? null,
		industry: response.industry ?? null,
		city: response.location?.city ?? null,
		region: response.location?.region ?? null,
		country: response.location?.country ?? null,
		linkedinUrl: response.linkedinUrl ?? null,
		websiteUrl: response.websiteUrl ?? null,
		employeeCount: response.employeeCount ?? null,
		foundedYear: response.foundedYear ?? null,
	};
}

function classify(cause: unknown): LookupResult {
	const reason = describe(cause);

	if (cause instanceof PramaanLookupError) {
		return { outcome: cause.outcome, reason, retryable: cause.retryable };
	}

	return { outcome: "failed", reason, retryable: true };
}

/** Carries the outcome a lookup should report, so callers keep their three-way shape. */
export class PramaanLookupError extends Error {
	readonly outcome: "skipped" | "failed";
	readonly retryable: boolean;

	constructor(
		outcome: "skipped" | "failed",
		retryable: boolean,
		message?: string,
	) {
		super(message ?? outcome);
		this.name = "PramaanLookupError";
		this.outcome = outcome;
		this.retryable = retryable;
	}
}

export async function extract(
	url: string,
	schema: JsonSchema,
	instructions: string,
): Promise<
	{ outcome: "found"; data: unknown } | { outcome: "failed"; reason: string }
> {
	const api = pramaan();
	if (!api) {
		return { outcome: "failed", reason: "Pramaan is not configured." };
	}

	try {
		const response = await api.webExtract({
			url,
			schema,
			prompt: instructions,
		});
		return { outcome: "found", data: response.data };
	} catch (error) {
		return { outcome: "failed", reason: describe(error) };
	}
}

export async function search(
	query: string,
	options: { limit?: number } = {},
): Promise<
	| { outcome: "found"; results: SearchResult[] }
	| { outcome: "failed"; reason: string }
> {
	const api = pramaan();
	if (!api) {
		return { outcome: "failed", reason: "Pramaan is not configured." };
	}

	try {
		const response = await api.webSearch({
			query,
			limit: options.limit ?? 10,
		});

		const results = response.results.map((result) => ({
			url: result.url ?? null,
			title: result.title ?? null,
			description: result.snippet ?? null,
			markdown: null,
		}));

		return { outcome: "found", results };
	} catch (error) {
		return { outcome: "failed", reason: describe(error) };
	}
}

export function describe(cause: unknown): string {
	if (cause instanceof Error) return cause.message;
	return String(cause);
}

// Kept for callers that validate shapes of data already stored.
export const rawText = z.string().nullable().catch(null);
export const textOrNull = z.string().trim().min(1).nullable().catch(null);
