import { expect, test } from "bun:test";
import { FakePramaan } from "@crm/pramaan/fake";
import { CalendarClient } from "../src/google/calendar.client";
import { GmailClient } from "../src/google/gmail.client";
import { GraphClient } from "../src/microsoft/graph.client";
import { OutlookCalendarSyncService } from "../src/microsoft/outlook-calendar-sync.service";
import { AppsConnectionService } from "../src/pramaan/apps-connection.service";

function fixture(action: string, output: unknown) {
	const fake = new FakePramaan({
		"apps.catalog.search": () => ({
			results: [
				{
					app: action.startsWith("GMAIL")
						? "gmail"
						: action.startsWith("OUTLOOK")
							? "outlook"
							: "googlecalendar",
					action,
				},
			],
		}),
		"apps.action.execute": () => ({ status: "succeeded", output }),
	});
	return { fake, apps: new AppsConnectionService(fake, {} as never) };
}
test("mail polling lists five newest IDs within fourteen days and retains the next page", async () => {
	const { fake, apps } = fixture("GMAIL_FETCH_EMAILS", {
		messages: [{ messageId: "m1" }],
		nextPageToken: "next",
	});
	const client = new GmailClient(apps);
	const first = await client.listHistory("crm-u", {
		startHistoryId: "2020-01-01T00:00:00.000Z",
	});
	expect(first.outcome).toBe("ok");
	if (first.outcome !== "ok") return;
	const cursor = JSON.parse(first.data.historyId!);
	expect(
		new Date(cursor.before).getTime() - new Date(cursor.after).getTime(),
	).toBe(14 * 86400000);
	const request = fake.callsTo("apps.action.execute")[0] as {
		input: Record<string, unknown>;
	};
	expect(request.input.max_results).toBe(5);
	expect(request.input.ids_only).toBe(true);
	expect(request.input.query).toContain("after:");
	expect(request.input).not.toHaveProperty("after");
	await client.listHistory("crm-u", { startHistoryId: first.data.historyId! });
	expect(
		(
			fake.callsTo("apps.action.execute")[1] as {
				input: Record<string, unknown>;
			}
		).input.page_token,
	).toBe("next");
	const keys = fake.calls
		.filter((c) => c.id === "apps.action.execute")
		.map((c) => c.opts?.idempotencyKey);
	expect(keys[0]).toBeTruthy();
	expect(keys[1]).not.toBe(keys[0]);
});
test("mail detail uses the exact action and preserves MIME Message-ID and body", async () => {
	const payload = {
		headers: [
			{ name: "Message-ID", value: "<m@example.test>" },
			{ name: "From", value: "a@example.test" },
		],
		body: { data: "aGk" },
		mimeType: "text/plain",
	};
	const { fake, apps } = fixture("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {
		id: "m1",
		internalDate: "1700000000000",
		payload,
	});
	const result = await new GmailClient(apps).getMessage("crm-u", "m1");
	expect(result.outcome).toBe("ok");
	if (result.outcome === "ok") expect(result.data.payload).toEqual(payload);
	expect(
		(
			fake.callsTo("apps.action.execute")[0] as {
				input: Record<string, unknown>;
			}
		).input,
	).toEqual({
		message_id: "m1",
		format: "full",
	});
});
test("calendar expands recurring events and retains cancellation, original start, paging and attendee flags", async () => {
	const { fake, apps } = fixture("GOOGLECALENDAR_EVENTS_LIST", {
		items: [
			{
				id: "e",
				iCalUID: "uid",
				status: "cancelled",
				recurringEventId: "series",
				originalStartTime: { dateTime: "2026-10-20T09:00:00Z" },
				attendees: [{ email: "x@example.test", self: true, resource: true }],
			},
		],
		nextPageToken: "next",
	});
	const result = await new CalendarClient(apps).listEvents("crm-u", {
		pageToken: "previous",
	});
	if (result.outcome !== "ok") throw Error("failed");
	expect(result.data.items?.[0]?.status).toBe("cancelled");
	expect(result.data.items?.[0]?.originalStartTime).toEqual({
		dateTime: "2026-10-20T09:00:00Z",
	});
	expect(result.data.items?.[0]?.attendees?.[0]?.resource).toBe(true);
	expect(result.data.nextPageToken).toBe("next");
	expect(
		(
			fake.callsTo("apps.action.execute")[0] as {
				input: Record<string, unknown>;
			}
		).input,
	).toMatchObject({
		singleEvents: true,
		pageToken: "previous",
		maxResults: 25,
	});
});
test("mail folder request uses catalogued fields and reads native addresses and body", async () => {
	const { fake, apps } = fixture("OUTLOOK_LIST_MAIL_FOLDER_MESSAGES", {
		value: [
			{
				id: "m",
				internetMessageId: "<m@example.test>",
				from: { emailAddress: { address: "a@example.test", name: "A" } },
				body: { content: "hello" },
				toRecipients: [{ emailAddress: { address: "b@example.test" } }],
			},
		],
	});
	const client = new GraphClient(apps);
	const result = await client.listMessages("crm-u", {
		after: new Date("2026-10-01T00:00:00Z"),
		top: 5,
	});
	expect(
		(
			fake.callsTo("apps.action.execute")[0] as {
				input: Record<string, unknown>;
			}
		).input,
	).toEqual({
		mail_folder_id: "inbox",
		filter: "receivedDateTime ge 2026-10-01T00:00:00.000Z",
		orderby: "receivedDateTime asc",
		top: 5,
	});
	if (result.outcome !== "ok") throw Error("failed");
	expect(result.data.value?.[0]?.from?.emailAddress?.address).toBe(
		"a@example.test",
	);
	expect(result.data.value?.[0]?.body?.content).toBe("hello");
	expect(await client.folder("crm-u", "junkemail")).toEqual({
		outcome: "ok",
		data: { id: "junkemail" },
	});
});
test("calendar view accepts native date objects and nested participants", async () => {
	const { fake, apps } = fixture("OUTLOOK_GET_CALENDAR_VIEW", {
		value: [
			{
				id: "e",
				start: { dateTime: "2026-10-20T09:30:00.0000000", timeZone: "UTC" },
				end: { dateTime: "2026-10-20T10:15:00.0000000", timeZone: "UTC" },
				organizer: { emailAddress: { address: "a@example.test" } },
				attendees: [{ emailAddress: { address: "b@example.test", name: "B" } }],
				location: { displayName: "Room" },
			},
		],
	});
	const service = new OutlookCalendarSyncService(
		{} as never,
		apps,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
	);
	const events = await service.listEvents("crm-u");
	expect(events).toHaveLength(1);
	expect(events[0]?.startsAt.toISOString()).toBe("2026-10-20T09:30:00.000Z");
	expect(events[0]?.organizer).toBe("a@example.test");
	expect(events[0]?.attendees).toEqual([
		{ email: "b@example.test", name: "B" },
	]);
	expect(
		(
			fake.callsTo("apps.action.execute")[0] as {
				input: Record<string, unknown>;
			}
		).input,
	).toMatchObject({
		start_datetime: expect.any(String),
		end_datetime: expect.any(String),
		top: 25,
	});
});

test("calendar resumes after five pages using the original window", async () => {
	const { CalendarSyncService } = await import(
		"../src/google/calendar-sync.service"
	);
	const fake = new FakePramaan({
		"apps.catalog.search": () => ({
			results: [
				{ app: "googlecalendar", action: "GOOGLECALENDAR_EVENTS_LIST" },
			],
		}),
		"apps.action.execute": (raw) => {
			const input = (raw as { input: { pageToken?: string } }).input;
			const page = Number(input.pageToken ?? 0);
			return {
				status: "succeeded",
				output: {
					items: [
						{
							id: `e${page}`,
							iCalUID: `uid${page}`,
							start: { dateTime: "2050-01-01T09:00:00Z" },
							end: { dateTime: "2050-01-01T10:00:00Z" },
						},
					],
					...(page < 5 ? { nextPageToken: String(page + 1) } : {}),
				},
			};
		},
	});
	const settles: { cursor: string | null }[] = [];
	let writes = 0;
	const db = {
		calendarEvent: { upsert: async () => ({ id: `saved${++writes}` }) },
		activity: { upsert: async () => ({ createdAt: new Date() }) },
	};
	const service = new CalendarSyncService(
		db as never,
		new CalendarClient(new AppsConnectionService(fake, {} as never)),
		{
			accessTokenFor: async () => ({ outcome: "ok", accessToken: "crm-u" }),
		} as never,
		{
			internalIdentity: async () => ({
				addresses: new Set(),
				domains: new Set(),
			}),
			suppressedDomains: async () => new Set(),
			suppressedEmails: async () => new Set(),
			resolve: async () => ({ companyId: "c", contactId: null }),
		} as never,
		{
			markRunning: async () => {},
			settle: async (_id: string, update: { cursor: string | null }) => {
				settles.push(update);
			},
		} as never,
		{ touch: async () => {} } as never,
		{} as never,
	);
	const row = { id: "s", userId: "u", cursor: null, autoCreate: true };
	await service.sync(row as never);
	expect(writes).toBe(5);
	expect(JSON.parse(settles[0]!.cursor!).pageToken).toBe("5");
	await service.sync({ ...row, cursor: settles[0]!.cursor } as never);
	expect(writes).toBe(6);
	expect(settles[1]!.cursor).toBeNull();
	const calls = fake.callsTo("apps.action.execute") as {
		input: { timeMin: string; timeMax: string };
	}[];
	expect(calls[5]!.input.timeMin).toBe(calls[0]!.input.timeMin);
	expect(calls[5]!.input.timeMax).toBe(calls[0]!.input.timeMax);
});

test("fresh mail sync backfills and hands complete native messages to the writer", async () => {
	const { GmailSyncService } = await import("../src/google/gmail-sync.service");
	const fake = new FakePramaan({
		"apps.catalog.search": () => ({
			results: [
				{ app: "gmail", action: "GMAIL_FETCH_EMAILS" },
				{ app: "gmail", action: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID" },
			],
		}),
		"apps.action.execute": (raw) => ({
			status: "succeeded",
			output:
				(raw as { action: string }).action === "GMAIL_FETCH_EMAILS"
					? { messages: [{ messageId: "m1" }] }
					: {
							messageId: "m1",
							messageTimestamp: "2026-10-18T08:00:00Z",
							payload: {
								mimeType: "text/plain",
								headers: [
									{ name: "Message-ID", value: "<real@example.test>" },
									{ name: "From", value: "a@example.test" },
									{ name: "To", value: "b@example.test" },
									{ name: "Date", value: "Sun, 18 Oct 2026 08:00:00 +0000" },
								],
								body: { data: "aGVsbG8" },
							},
						},
		}),
	});
	let stored: unknown;
	const updates: unknown[] = [];
	const client = new GmailClient(
		new AppsConnectionService(fake, {
			user: { findUnique: async () => ({ email: "b@example.test" }) },
		} as never),
	);
	const service = new GmailSyncService(
		{ emailMessage: { findMany: async () => [] } } as never,
		client,
		{
			accessTokenFor: async () => ({ outcome: "ok", accessToken: "crm-u" }),
		} as never,
		{
			markRunning: async () => {},
			settle: async (_id: string, update: unknown) => updates.push(update),
		} as never,
		{
			context: async () => ({}),
			store: async (_row: unknown, _opts: unknown, message: unknown) => {
				stored = message;
				return true;
			},
		} as never,
	);
	const outcome = await service.sync({
		id: "s",
		userId: "u",
		cursor: null,
	} as never);
	expect(outcome.messagesWritten).toBe(1);
	expect(stored).toMatchObject({
		gmailMessageId: "m1",
		rfcMessageId: "real@example.test",
		body: "hello",
	});
	expect(updates).toHaveLength(1);
});

test("raw headers recover sender addresses removed from the full detail response", async () => {
	const raw = Buffer.from(
		"From: Person <person@example.test>\r\nMessage-ID: <real@example.test>\r\nTo: Team\r\n <team@example.test>\r\nDate: Sun, 18 Oct 2026 08:00:00 +0000\r\n\r\nHello",
	).toString("base64url");
	const fake = new FakePramaan({
		"apps.catalog.search": () => ({
			results: [{ app: "gmail", action: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID" }],
		}),
		"apps.action.execute": (input) => ({
			status: "succeeded",
			output:
				(input as { input: { format: string } }).input.format === "raw"
					? { raw }
					: {
							messageId: "m",
							payload: {
								mimeType: "text/plain",
								headers: [{ name: "From", value: "Person" }],
								body: { data: "SGVsbG8" },
							},
						},
		}),
	});
	const result = await new GmailClient(
		new AppsConnectionService(fake, {} as never),
	).getMessage("crm-u", "m");
	expect(result.outcome).toBe("ok");
	if (result.outcome !== "ok") return;
	expect(result.data.payload?.headers).toContainEqual({
		name: "From",
		value: "Person <person@example.test>",
	});
	expect(result.data.payload?.headers).toContainEqual({
		name: "To",
		value: "Team <team@example.test>",
	});
	expect(result.data.payload?.body?.data).toBe("SGVsbG8");
	const keys = fake.calls
		.filter((c) => c.id === "apps.action.execute")
		.map((c) => c.opts?.idempotencyKey);
	expect(keys[0]).not.toBe(keys[1]);
});

test("a timed-out read gets a fresh key on the next attempt", async () => {
	let attempts = 0;
	const fake = new FakePramaan({
		"apps.catalog.search": () => ({
			results: [{ app: "gmail", action: "GMAIL_FETCH_EMAILS" }],
		}),
		"apps.action.execute": () => {
			if (++attempts === 1)
				throw Error("The call took too long and was stopped.");
			return { status: "succeeded", output: { messages: [] } };
		},
	});
	const client = new GmailClient(new AppsConnectionService(fake, {} as never));
	const options = {
		after: new Date("2026-10-04T00:00:00Z"),
		before: new Date("2026-10-18T00:00:00Z"),
	};
	expect((await client.listMessages("crm-u", options)).outcome).toBe("failed");
	expect((await client.listMessages("crm-u", options)).outcome).toBe("ok");
	const keys = fake.calls
		.filter((c) => c.id === "apps.action.execute")
		.map((c) => c.opts?.idempotencyKey);
	expect(keys[0]).toBeTruthy();
	expect(keys[1]).not.toBe(keys[0]);
});
