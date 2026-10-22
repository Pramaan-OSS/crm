import { expect, test } from "bun:test";
import type { Db } from "@crm/db";
import { FakePramaan } from "@crm/pramaan/fake";
import { GmailClient } from "../src/google/gmail.client";
import { AppsConnectionService } from "../src/pramaan/apps-connection.service";

function fixture({
	field = "startHistoryId",
	checked = true,
	requiredAccount = false,
	failed = false,
	paged = false,
} = {}) {
	const fake = new FakePramaan({
		"apps.catalog.search": () => ({
			results: [
				{
					app: "gmail",
					action: "GMAIL_LIST_HISTORY",
					...(checked
						? {
								readOnly: true,
								inputSchema: {
									type: "object",
									properties: {
										[field]: { type: "string" },
										...(requiredAccount ? { account: { type: "string" } } : {}),
									},
									required: [field, ...(requiredAccount ? ["account"] : [])],
									additionalProperties: false,
								},
							}
						: {}),
				},
				{ app: "gmail", action: "GMAIL_FETCH_EMAILS" },
			],
		}),
		"apps.action.execute": (input) => {
			const action = (input as { action: string }).action;
			if (action === "GMAIL_LIST_HISTORY") {
				if (failed) throw new Error("Unavailable");
				return {
					status: "succeeded",
					output: {
						historyId: "125",
						history: [
							{
								id: "124",
								messagesAdded: [
									{ message: { id: "message-history", threadId: "thread" } },
								],
							},
						],
						...(paged ? { nextPageToken: "more" } : {}),
					},
				};
			}
			return {
				status: "succeeded",
				output: { messages: [{ id: "message-poll" }] },
			};
		},
	});
	return {
		fake,
		client: new GmailClient(new AppsConnectionService(fake, {} as Db)),
	};
}
for (const field of ["startHistoryId", "start_history_id"])
	test(`history uses only the catalogue's ${field} field and the connected action`, async () => {
		const { fake, client } = fixture({ field });
		const result = await client.listHistory("crm-fixture", {
			startHistoryId: "123",
		});
		expect(result.outcome).toBe("ok");
		if (result.outcome === "ok") expect(result.data.historyId).toBe("125");
		expect(fake.callsTo("apps.action.execute")).toEqual([
			{
				endUserRef: "crm-fixture",
				action: "GMAIL_LIST_HISTORY",
				input: { [field]: "123" },
			},
		]);
	});
for (const options of [
	{ checked: false },
	{ requiredAccount: true },
	{ failed: true },
	{ paged: true },
])
	test(`unchecked, unavailable or paged history retains polling: ${JSON.stringify(options)}`, async () => {
		const { fake, client } = fixture(options);
		const result = await client.listHistory("crm-fixture", {
			startHistoryId: "123",
		});
		expect(result.outcome).toBe("ok");
		if (result.outcome === "ok")
			expect(result.data.history?.[0]?.messagesAdded?.[0]?.message?.id).toBe(
				"message-poll",
			);
		expect(
			(fake.callsTo("apps.action.execute").at(-1) as { action: string }).action,
		).toBe("GMAIL_FETCH_EMAILS");
		if (options.checked === false || options.requiredAccount)
			expect(fake.callsTo("apps.action.execute")).toHaveLength(1);
	});
test("an existing date cursor keeps polling and is never sent as a history id", async () => {
	const { fake, client } = fixture();
	await client.listHistory("crm-fixture", {
		startHistoryId: "2026-10-13T00:00:00.000Z",
	});
	expect(fake.callsTo("apps.action.execute")).toHaveLength(1);
	expect(
		(fake.callsTo("apps.action.execute")[0] as { action: string }).action,
	).toBe("GMAIL_FETCH_EMAILS");
});

test("a native cursor is not mistaken for a year in the polling fallback", async () => {
	const { cursorStart } = await import("../src/google/gmail.client");
	const since = cursorStart("123");
	expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(60 * 60 * 1000);
	expect(Date.now() - since.getTime()).toBeLessThan(60 * 60 * 1000 + 1000);
});
