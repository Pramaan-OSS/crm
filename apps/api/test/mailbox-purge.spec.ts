import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { ActivityType, db, EmailDirection, GoogleSyncStatus } from "@crm/db";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { GoogleConnectionService } from "../src/google/google-connection.service";
import type { MailboxMatchService } from "../src/mailbox/mailbox-match.service";
import { MailboxTokenService } from "../src/mailbox/mailbox-token.service";
import { SyncStateService } from "../src/mailbox/sync-state.service";
import { MicrosoftConnectionService } from "../src/microsoft/microsoft-connection.service";
import { AppsConnectionService } from "../src/pramaan/apps-connection.service";

const suffix = process.env.TEST_RUN_ID ?? "mailbox-purge-spec";
const domain = `purge-${suffix}.test`;

const gmailRep = `gmail-rep-${suffix}`;
const outlookRep = `outlook-rep-${suffix}`;
const otherRep = `other-rep-${suffix}`;
const userIds = [gmailRep, outlookRep, otherRep];

const shared = `shared-${suffix}`;
const solo = `solo-${suffix}`;
const theirs = `theirs-${suffix}`;
const roots = [shared, solo, theirs];

// Connected apps, faked: a rep connects by marking the app active. No network.
const connectedApps = new Set<string>(["gmail", "google_calendar", "outlook"]);
const revokedApps: string[] = [];

const apps = {
	configured: () => true,
	endUserRef: (userId: string) => `crm-${userId}`,
	statusFor: async (_userId: string, app: string) =>
		connectedApps.has(app) ? "active" : "none",
	listStatuses: async (_userId: string, only?: readonly string[]) => {
		const rows = new Map<string, string>();
		for (const app of only ?? ["gmail", "google_calendar", "outlook"]) {
			if (connectedApps.has(app)) rows.set(app, "active");
		}
		return rows;
	},
	startConnect: async (_userId: string, app: string) => ({
		connectUrl: `https://connect.test/${app}`,
	}),
	revoke: async (_userId: string, app: string) => {
		revokedApps.push(app);
		connectedApps.delete(app);
	},
	executeAction: async () => ({
		outcome: "failed" as const,
		reason: "not wired in this spec",
		retryable: false,
	}),
	emailForRef: async (ref: string) =>
		ref.endsWith(gmailRep) ? "rep@gmail.test" : null,
} as unknown as AppsConnectionService;

const tokens = new MailboxTokenService(apps);
const state = new SyncStateService(db);
const stamp = new ActivityStampService(db);

const google = new GoogleConnectionService(
	db,
	apps,
	tokens,
	state,
	{} as unknown as MailboxMatchService,
	stamp,
);
const microsoft = new MicrosoftConnectionService(
	db,
	apps,
	tokens,
	state,
	stamp,
);

function at(hour: number): Date {
	return new Date(Date.UTC(2026, 0, 1, hour));
}

type Wire = {
	id: string;
	syncedByUserId: string;
	provider: "gmail" | "outlook";
	sentAt: Date;
	subject: string;
	snippet: string;
};

async function thread(
	rootMessageId: string,
	companyId: string,
	messages: Wire[],
): Promise<void> {
	const first = messages[0];
	const last = messages[messages.length - 1];
	if (!first || !last) return;

	await db.emailThread.create({
		data: {
			rootMessageId,
			subject: first.subject,
			companyId,
			firstMessageAt: first.sentAt,
			lastMessageAt: last.sentAt,
			messageCount: messages.length,
			messages: {
				create: messages.map((message) => ({
					rfcMessageId: `${message.id}@${domain}`,
					syncedByUserId: message.syncedByUserId,
					gmailMessageId: message.provider === "gmail" ? message.id : null,
					outlookMessageId: message.provider === "outlook" ? message.id : null,
					direction: EmailDirection.INBOUND,
					fromEmail: `them@${domain}`,
					recipients: [],
					subject: message.subject,
					snippet: message.snippet,
					sentAt: message.sentAt,
				})),
			},
			activity: {
				create: {
					type: ActivityType.EMAIL,
					subject: first.subject,
					body: last.snippet,
					occurredAt: last.sentAt,
					companyId,
					createdById: first.syncedByUserId,
					meta: { synced: true },
				},
			},
		},
	});
}

async function seed(): Promise<void> {
	const company = await db.company.create({
		data: { name: "Purge Co", domain },
		select: { id: true },
	});

	await thread(shared, company.id, [
		{
			id: `m1-${suffix}`,
			syncedByUserId: gmailRep,
			provider: "gmail",
			sentAt: at(9),
			subject: "Kickoff",
			snippet: "first",
		},
		{
			id: `m2-${suffix}`,
			syncedByUserId: outlookRep,
			provider: "outlook",
			sentAt: at(10),
			subject: "Re: Kickoff",
			snippet: "second",
		},
		{
			id: `m3-${suffix}`,
			syncedByUserId: otherRep,
			provider: "gmail",
			sentAt: at(11),
			subject: "Re: Kickoff",
			snippet: "third",
		},
	]);

	await thread(solo, company.id, [
		{
			id: `m4-${suffix}`,
			syncedByUserId: gmailRep,
			provider: "gmail",
			sentAt: at(8),
			subject: "Only mine",
			snippet: "alone",
		},
	]);

	await thread(theirs, company.id, [
		{
			id: `m5-${suffix}`,
			syncedByUserId: outlookRep,
			provider: "outlook",
			sentAt: at(7),
			subject: "Not mine",
			snippet: "untouched",
		},
	]);

	await db.calendarEvent.create({
		data: {
			iCalUid: `ical-${suffix}`,
			originalStartTime: at(12),
			startsAt: at(12),
			endsAt: at(13),
			status: "confirmed",
			companyId: company.id,
			syncedByUserId: gmailRep,
		},
	});
}

async function clean(): Promise<void> {
	await db.calendarEvent.deleteMany({
		where: { syncedByUserId: { in: userIds } },
	});
	await db.emailThread.deleteMany({ where: { rootMessageId: { in: roots } } });
	await db.mailboxSync.deleteMany({ where: { userId: { in: userIds } } });
	await db.account.deleteMany({ where: { userId: { in: userIds } } });
	await db.user.deleteMany({ where: { id: { in: userIds } } });
	await db.company.deleteMany({ where: { domain } });
}

async function messagesOn(rootMessageId: string): Promise<string[]> {
	const rows = await db.emailMessage.findMany({
		where: { thread: { rootMessageId } },
		orderBy: { sentAt: "asc" },
		select: { snippet: true },
	});

	return rows.map((row) => row.snippet ?? "");
}

async function threadState(rootMessageId: string) {
	return db.emailThread.findUnique({
		where: { rootMessageId },
		select: {
			subject: true,
			messageCount: true,
			firstMessageAt: true,
			lastMessageAt: true,
			activity: { select: { body: true, occurredAt: true } },
		},
	});
}

beforeEach(async () => {
	await clean();

	await db.user.createMany({
		data: userIds.map((id) => ({
			id,
			name: id,
			email: `${id}@${domain}`,
		})),
	});

	await seed();
});

afterAll(clean);

describe("purging Gmail data", () => {
	it("removes only the caller's Gmail messages and counts them", async () => {
		expect(await google.purgeSyncedData(gmailRep)).toEqual({ purged: 3 });
	});

	it("leaves a thread standing when somebody else's messages remain", async () => {
		await google.purgeSyncedData(gmailRep);

		expect(await messagesOn(shared)).toEqual(["second", "third"]);
		expect(await threadState(shared)).toEqual({
			subject: "Re: Kickoff",
			messageCount: 2,
			firstMessageAt: at(10),
			lastMessageAt: at(11),
			activity: { body: "third", occurredAt: at(11) },
		});
	});

	it("takes the thread and its activity when nothing is left", async () => {
		await google.purgeSyncedData(gmailRep);

		expect(await threadState(solo)).toBeNull();
		expect(await db.activity.count({ where: { subject: "Only mine" } })).toBe(
			0,
		);
	});

	it("cannot reach a thread the caller never synced into", async () => {
		await google.purgeSyncedData(gmailRep);

		expect(await messagesOn(theirs)).toEqual(["untouched"]);
		expect(await threadState(theirs)).toEqual({
			subject: "Not mine",
			messageCount: 1,
			firstMessageAt: at(7),
			lastMessageAt: at(7),
			activity: { body: "untouched", occurredAt: at(7) },
		});
	});
});

describe("purging Outlook data", () => {
	it("removes only the caller's Outlook messages and counts them", async () => {
		expect(await microsoft.purgeSyncedData(outlookRep)).toEqual({ purged: 2 });
	});

	it("leaves the Gmail messages on a shared thread alone", async () => {
		await microsoft.purgeSyncedData(outlookRep);

		expect(await messagesOn(shared)).toEqual(["first", "third"]);
		expect(await threadState(shared)).toEqual({
			subject: "Kickoff",
			messageCount: 2,
			firstMessageAt: at(9),
			lastMessageAt: at(11),
			activity: { body: "third", occurredAt: at(11) },
		});
	});

	it("cannot delete another user's Gmail thread", async () => {
		await microsoft.purgeSyncedData(outlookRep);

		expect(await messagesOn(solo)).toEqual(["alone"]);
		expect(
			await db.calendarEvent.count({ where: { iCalUid: `ical-${suffix}` } }),
		).toBe(1);
	});
});

describe("disconnecting Microsoft", () => {
	async function connect() {
		connectedApps.add("outlook");
		await state.ensure(outlookRep, "outlook", { autoCreate: false });
	}

	beforeEach(() => {
		connectedApps.clear();
		revokedApps.length = 0;
	});

	it("revokes the connection and keeps the sign-in alone", async () => {
		await connect();

		expect(await microsoft.revoke(outlookRep)).toEqual({ revoked: true });
		expect(revokedApps).toEqual(["outlook"]);

		const status = await microsoft.status(outlookRep);
		expect(status.linked).toBe(false);
		expect(await state.get(outlookRep, "outlook")).toBeNull();
	});

	it("stays disconnected instead of re-creating the sync row", async () => {
		await connect();

		await microsoft.revoke(outlookRep);
		const status = await microsoft.status(outlookRep);

		expect(status.linked).toBe(false);
		expect(status.required).toBe(true);
		expect(await state.get(outlookRep, "outlook")).toBeNull();
	});

	it("offers Connect to a rep with nothing connected", async () => {
		const status = await microsoft.status(outlookRep);

		expect(status.linked).toBe(false);
		expect(status.sources.every((source) => !source.connected)).toBe(true);
	});

	it("is linked while Outlook is connected", async () => {
		await connect();

		const status = await microsoft.status(outlookRep);

		expect(status.linked).toBe(true);
		expect(await state.get(outlookRep, "outlook")).not.toBeNull();
	});
});

describe("disconnecting Google", () => {
	beforeEach(() => {
		connectedApps.clear();
		revokedApps.length = 0;
	});

	async function connect() {
		connectedApps.add("gmail");
		connectedApps.add("google_calendar");
		await state.ensure(gmailRep, "gmail", { autoCreate: false });
		await state.ensure(gmailRep, "calendar", { autoCreate: true });
	}

	it("clears both sources without asking anybody else", async () => {
		await connect();

		let calls = 0;
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			calls += 1;
			return new Response(null, { status: 200 });
		}) as unknown as typeof fetch;

		try {
			expect(await google.revoke(gmailRep)).toEqual({ revoked: true });
		} finally {
			globalThis.fetch = realFetch;
		}

		expect(calls).toBe(0);
		expect(revokedApps.sort()).toEqual(["gmail", "google_calendar"]);
		expect((await google.status(gmailRep)).linked).toBe(false);
	});

	it("refuses to clear when the connection will not go", async () => {
		await connect();

		const refusing = {
			...apps,
			revoke: async (_userId: string, app: string) => {
				throw new Error("The connection could not be revoked.");
			},
		} as unknown as AppsConnectionService;

		const stubborn = new GoogleConnectionService(
			db,
			refusing,
			new MailboxTokenService(refusing),
			state,
			{} as unknown as MailboxMatchService,
			stamp,
		);

		expect(await stubborn.revoke(gmailRep)).toEqual({ revoked: false });
		expect((await stubborn.status(gmailRep)).linked).toBe(true);
	});

	it("offers Connect to a rep with nothing connected", async () => {
		const status = await google.status(gmailRep);

		expect(status.linked).toBe(false);
		expect(status.sources.every((source) => !source.connected)).toBe(true);
	});

	it("is linked while both sources are connected", async () => {
		await connect();

		const status = await google.status(gmailRep);

		expect(status.linked).toBe(true);
		expect(
			status.sources.filter((source) => source.status === GoogleSyncStatus.IDLE)
				.length,
		).toBe(2);
	});
});
