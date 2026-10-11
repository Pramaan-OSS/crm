import { isGoogleConfigured } from "@crm/auth";
import type { Db, Prisma } from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { normalizeDomain } from "../companies/domain";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import { APP_FOR_SOURCE } from "../mailbox/mailbox.constants";
import { MailboxMatchService } from "../mailbox/mailbox-match.service";
import { MailboxTokenService } from "../mailbox/mailbox-token.service";
import { SyncStateService } from "../mailbox/sync-state.service";
import {
	APP_GMAIL,
	APP_GOOGLE_CALENDAR,
	AppsConnectionService,
} from "../pramaan/apps-connection.service";
import {
	GOOGLE_PROVIDER_ID,
	GOOGLE_SYNC_SOURCES,
	type GoogleSyncSource,
	SCOPE_FOR_SOURCE,
} from "./google.constants";
import type {
	ConnectOutput,
	GoogleConnectionStatus,
	GoogleSourceStatus,
	PurgeSyncedDataOutput,
	RevokeAccessOutput,
	SuppressDomainOutput,
} from "./google.contracts";

const PURGE_TIMEOUT_MS = 60_000;

@Injectable()
export class GoogleConnectionService {
	private readonly logger = new Logger(GoogleConnectionService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly apps: AppsConnectionService,
		private readonly tokens: MailboxTokenService,
		private readonly state: SyncStateService,
		private readonly match: MailboxMatchService,
		private readonly stamp: ActivityStampService,
	) {}

	async status(userId: string): Promise<GoogleConnectionStatus> {
		await this.onConnected(userId);

		const [granted, rows, hasRefreshToken] = await Promise.all([
			this.tokens.grantedScopes(userId, GOOGLE_PROVIDER_ID),
			this.state.listForUser(userId, GOOGLE_SYNC_SOURCES),
			this.tokens.hasRefreshToken(userId, GOOGLE_PROVIDER_ID),
		]);

		const bySource = new Map(rows.map((row) => [row.source, row]));

		const sources = GOOGLE_SYNC_SOURCES.map((source): GoogleSourceStatus => {
			const row = bySource.get(source);
			const connected = granted.has(SCOPE_FOR_SOURCE[source]);

			return {
				source,
				connected,
				status: row?.status ?? null,
				lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
				lastError: row?.lastError ?? null,
				autoCreate: row?.autoCreate ?? false,
			};
		});

		return {
			configured: this.apps.configured(),
			// Linked = at least one connected source; connecting is offered to
			// everybody through the hosted sign-in link.
			linked: sources.some((source) => source.connected),
			required: true,
			hasRefreshToken,
			sources,
		};
	}

	async onConnected(userId: string): Promise<void> {
		const [granted, existing] = await Promise.all([
			this.tokens.grantedScopes(userId, GOOGLE_PROVIDER_ID),
			this.state.listForUser(userId, GOOGLE_SYNC_SOURCES),
		]);

		const known = new Set(existing.map((row) => row.source));

		const added: string[] = [];

		for (const source of GOOGLE_SYNC_SOURCES) {
			if (!granted.has(SCOPE_FOR_SOURCE[source])) continue;
			if (known.has(source)) continue;

			await this.state.ensure(userId, source, {
				autoCreate: source === "calendar",
			});

			added.push(source);
		}

		if (added.length > 0) {
			this.logger.log({ message: "Google connected", userId, sources: added });
		}
	}

	async purgeSyncedData(userId: string): Promise<PurgeSyncedDataOutput> {
		const mine: Prisma.EmailMessageWhereInput = {
			syncedByUserId: userId,
			gmailMessageId: { not: null },
		};

		const purged = await this.db.$transaction(
			async (tx) => {
				const touched = await tx.emailMessage.findMany({
					where: mine,
					select: { threadId: true },
					distinct: ["threadId"],
				});

				const threadIds = touched.map((row) => row.threadId);
				const messages = await tx.emailMessage.deleteMany({ where: mine });

				await tx.emailThread.deleteMany({
					where: { id: { in: threadIds }, messages: { none: {} } },
				});

				await rebuildThreads(tx, threadIds);

				const events = await tx.calendarEvent.deleteMany({
					where: { syncedByUserId: userId },
				});

				return messages.count + events.count;
			},
			{ timeout: PURGE_TIMEOUT_MS },
		);

		await this.stamp.recomputeAll();

		this.logger.log({ message: "Google data purged", userId, purged });

		return { purged };
	}

	async connect(
		userId: string,
		source: GoogleSyncSource,
		redirectUrl: string,
	): Promise<ConnectOutput> {
		const result = await this.apps.startConnect(
			userId,
			source === "gmail" ? APP_GMAIL : APP_GOOGLE_CALENDAR,
			redirectUrl,
		);

		if ("error" in result) return { connectUrl: null, error: result.error };
		return { connectUrl: result.connectUrl, error: null };
	}

	async revoke(userId: string): Promise<RevokeAccessOutput> {
		for (const source of GOOGLE_SYNC_SOURCES) {
			await this.state.remove(userId, source);
		}

		const revoked = await this.tokens.revoke(userId, GOOGLE_PROVIDER_ID);
		return { revoked };
	}

	async setAutoCreate(
		userId: string,
		source: GoogleSyncSource,
		enabled: boolean,
	): Promise<void> {
		const row = await this.state.get(userId, source);
		if (!row) {
			throw new NotFoundException(`${source} is not connected.`);
		}

		await this.state.setAutoCreate(userId, source, enabled);
	}

	async suppressDomain(
		domain: string,
		options: { reason?: string; purge: boolean },
	): Promise<SuppressDomainOutput> {
		const normalised = normalizeDomain(domain);
		if (!normalised) {
			throw new NotFoundException(`"${domain}" is not a domain.`);
		}

		const ours = await this.match.internalIdentity();
		if (ours.domains.has(normalised)) {
			throw new NotFoundException(
				"That is our own domain — it is already excluded.",
			);
		}

		await this.db.suppressedDomain.upsert({
			where: { domain: normalised },
			create: { domain: normalised, reason: options.reason ?? null },
			update: { reason: options.reason ?? null },
		});

		if (!options.purge) return { domain: normalised, purged: 0 };

		const company = await this.db.company.findUnique({
			where: { domain: normalised },
			select: { id: true },
		});

		if (!company) return { domain: normalised, purged: 0 };

		const [threads, events] = await this.db.$transaction([
			this.db.emailThread.deleteMany({ where: { companyId: company.id } }),
			this.db.calendarEvent.deleteMany({ where: { companyId: company.id } }),
		]);

		await this.stamp.recomputeAll();

		this.logger.log({
			message: "Domain suppressed",
			domain: normalised,
			purged: threads.count + events.count,
		});

		return { domain: normalised, purged: threads.count + events.count };
	}
}

async function rebuildThreads(
	tx: Prisma.TransactionClient,
	threadIds: string[],
): Promise<void> {
	if (threadIds.length === 0) return;

	const remaining = await tx.emailMessage.findMany({
		where: { threadId: { in: threadIds } },
		select: { threadId: true, sentAt: true, subject: true, snippet: true },
		orderBy: { sentAt: "asc" },
	});

	const byThread = new Map<string, typeof remaining>();

	for (const message of remaining) {
		const group = byThread.get(message.threadId);
		if (group) group.push(message);
		else byThread.set(message.threadId, [message]);
	}

	for (const [threadId, messages] of byThread) {
		const first = messages.at(0);
		const last = messages.at(-1);
		if (!first || !last) continue;

		await tx.emailThread.update({
			where: { id: threadId },
			data: {
				messageCount: messages.length,
				firstMessageAt: first.sentAt,
				lastMessageAt: last.sentAt,
				subject: first.subject,
			},
		});

		await tx.activity.updateMany({
			where: { emailThreadId: threadId },
			data: { body: last.snippet, occurredAt: last.sentAt },
		});
	}
}
