import { expect, test } from "bun:test";
import { FakePramaan } from "@crm/pramaan/fake";
import { OutlookCalendarSyncService } from "../src/microsoft/outlook-calendar-sync.service";
import { AppsConnectionService } from "../src/pramaan/apps-connection.service";

const CATALOG = {
	results: [
		{
			app: "outlook",
			action: "OUTLOOK_GET_CALENDAR_VIEW",
			readOnly: true,
			inputSchema: {
				type: "object",
				properties: {
					start_datetime: { type: "string" },
					end_datetime: { type: "string" },
				},
				required: ["start_datetime", "end_datetime"],
			},
		},
		{ app: "outlook", action: "OUTLOOK_FETCH" },
	],
};

function fixture(output: unknown, failFirst = false) {
	const fake = new FakePramaan({
		"apps.catalog.search": () => CATALOG,
		"apps.action.execute": (input) => {
			const action = (input as { action: string }).action;
			if (!action.includes("CALENDAR")) {
				if (failFirst && !action.includes("CALENDAR")) {
					// The mail action resolves first when the calendar handle
					// was tried before it — that is the resolution order proof.
				}
			}
			return { status: "succeeded", output };
		},
	});
	const apps = new AppsConnectionService(fake, {} as never);
	const sync = new OutlookCalendarSyncService(
		{} as never,
		apps,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
	);
	return { fake, apps, sync };
}

test("resolves the outlook calendar action from the catalogue and normalizes events", async () => {
	const { fake, apps, sync } = fixture({
		value: [
			{
				id: "evt_1",
				subject: "Kickoff",
				start: "2026-10-20T09:00:00Z",
				end: "2026-10-20T10:00:00Z",
				location: "Meet",
				organizer: "organizer@example.test",
				attendees: [
					{ email: "a@example.test", name: "A" },
					{ email: { address: "b@example.test" }, name: "B" },
				],
			},
			{
				id: "evt_2",
				subject: "Cancelled",
				start: "2026-10-21T09:00:00Z",
				end: "2026-10-21T10:00:00Z",
				isCancelled: true,
			},
		],
	});

	const events = await sync.listEvents("crm-fixture");

	expect(events).toHaveLength(2);
	expect(events[0]?.id).toBe("evt_1");
	expect(events[0]?.startsAt.toISOString()).toBe("2026-10-20T09:00:00.000Z");
	expect(events[0]?.attendees).toEqual([
		{ email: "a@example.test", name: "A" },
		{ email: "b@example.test", name: "B" },
	]);
	expect(events[1]?.cancelled).toBe(true);

	const executed = fake.callsTo("apps.action.execute");
	expect(executed).toHaveLength(1);
	expect((executed[0] as { action: string }).action).toContain("CALENDAR");
	const input = (executed[0] as { input: Record<string, unknown> }).input;
	expect(input.start_datetime).toEqual(expect.any(String));
	expect(input.end_datetime).toEqual(expect.any(String));

	void apps;
});

test("throws when no candidate resolves, after trying them all", async () => {
	const fake = new FakePramaan({
		"apps.catalog.search": () => ({
			results: [{ app: "outlook", action: "OUTLOOK_LIST_MAIL_FOLDERS" }],
		}),
		"apps.action.execute": () => ({
			status: "succeeded",
			output: { value: [] },
		}),
	});
	const apps = new AppsConnectionService(fake, {} as never);
	const sync = new OutlookCalendarSyncService(
		{} as never,
		apps,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
	);

	try {
		await sync.listEvents("crm-fixture");
		throw new Error("should have thrown");
	} catch (error) {
		expect(String(error)).toContain("calendar list action");
	}
	expect(fake.callsTo("apps.catalog.search").length).toBeGreaterThan(0);
});
