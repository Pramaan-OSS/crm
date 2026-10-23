import { afterEach, describe, expect, it } from "bun:test";
import { SyncSchedulerService } from "../src/sync/sync-scheduler.service";

const summary = {
	attempted: 2,
	synced: 2,
	skipped: 0,
	rateLimited: 0,
	failed: 0,
	durationMs: 5,
};

function fixture({ disabled = false, delay = 0 } = {}) {
	const calls: number[] = [];
	const sync = {
		runDue: async () => {
			calls.push(calls.length);
			if (delay > 0) await new Promise((r) => setTimeout(r, delay));
			return summary;
		},
	};
	const config = {
		get: (_key: string, _opts?: unknown) => (disabled ? "off" : undefined),
	};
	const scheduler = new SyncSchedulerService(sync as never, config as never);
	return { scheduler, calls };
}

afterEach(() => {});

describe("the built-in sync scheduler", () => {
	it("ticks when enabled", async () => {
		const { scheduler, calls } = fixture();
		scheduler.start();
		expect(scheduler.scheduled).toBe(true);
		await scheduler.tick();
		expect(calls.length).toBe(1);
		scheduler.stop();
	});

	it("does not schedule when the switch is off", async () => {
		const { scheduler, calls } = fixture({ disabled: true });
		scheduler.start();

		expect(scheduler.scheduled).toBe(false);
		expect(calls.length).toBe(0);
		scheduler.stop();
	});

	it("collapses overlapping runs into one at a time", async () => {
		const { scheduler, calls } = fixture({ delay: 40 });
		const a = scheduler.tick();
		const b = scheduler.tick();
		await Promise.all([a, b]);
		expect(calls.length).toBe(1);
		scheduler.stop();
	});
});

// ── runForUser (real database, no live sync services wired) ────────────────
import { db } from "@crm/db";
import { GoogleConnectionService } from "../src/google/google-connection.service";
import { GoogleSyncService } from "../src/google/google-sync.service";
import { SyncStateService } from "../src/mailbox/sync-state.service";
import { MicrosoftConnectionService } from "../src/microsoft/microsoft-connection.service";
import { MicrosoftSyncService } from "../src/microsoft/microsoft-sync.service";
import { MailboxSyncService } from "../src/sync/mailbox-sync.service";

describe("runForUser (integration)", () => {
	const userId = `qa-sync-user-${Date.now()}`;
	const otherId = `qa-sync-other-${Date.now()}`;
	const created: string[] = [];

	const skipped = async () => ({ status: "skipped" as const });
	const sync = new MailboxSyncService(
		new SyncStateService(db),
		{ runOne: skipped } as unknown as GoogleSyncService,
		{ runOne: skipped } as unknown as MicrosoftSyncService,
		{} as GoogleConnectionService,
		{} as MicrosoftConnectionService,
	);

	afterEach(async () => {
		await db
			.$executeRawUnsafe(
				`DELETE FROM "mailboxSync" WHERE "userId" IN ('${userId}', '${otherId}')`,
			)
			.catch(() => {});
		await db
			.$executeRawUnsafe(
				`DELETE FROM "user" WHERE id IN ('${userId}', '${otherId}')`,
			)
			.catch(() => {});
	});

	it("syncs only due rows for one rep", async () => {
		await db.$executeRawUnsafe(
			`INSERT INTO "user" (id, name, email, "createdAt", "updatedAt") VALUES ('${userId}', 'QA Sync', 'qa.sync.${userId}@example.test', now(), now()), ('${otherId}', 'QA Sync Other', 'qa.sync.other.${userId}@example.test', now(), now())`,
		);
		for (const source of ["gmail", "outlook_calendar"]) {
			await db.$executeRawUnsafe(
				`INSERT INTO "mailboxSync" (id, "userId", source, "createdAt", "updatedAt") VALUES ('ms-${source}-${userId}', '${userId}', '${source}', now(), now())`,
			);
		}
		await db.$executeRawUnsafe(
			`INSERT INTO "mailboxSync" (id, "userId", source, "createdAt", "updatedAt") VALUES ('ms-other', '${otherId}', 'gmail', now(), now())`,
		);

		const summary = await sync.runForUser(userId);

		expect(summary.attempted).toBe(2);
		expect(summary.skipped).toBe(2);
		const untouched = await db.$queryRawUnsafe<{ n: number }[]>(
			`SELECT count(*)::int AS n FROM "mailboxSync" WHERE id = 'ms-other' AND "lastSyncedAt" IS NULL`,
		);
		expect(untouched[0]?.n).toBe(1);
	});
});
