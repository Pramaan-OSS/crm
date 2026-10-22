import { describe, expect, test } from "bun:test";
import type { Db } from "@crm/db";
import { FakePramaan } from "@crm/pramaan/fake";
import { AppsConnectionService } from "../src/pramaan/apps-connection.service";

describe("connected action discovery", () => {
	test("one page on demand, shared concurrent requests, separate sessions and searches", async () => {
		const fake = new FakePramaan({
			"apps.catalog.search": (input) => ({
				results: [
					{
						app: "mail",
						action: (input as { cursor?: string }).cursor
							? "MAIL_READ_FILE"
							: "MAIL_LIST",
					},
				],
				...(!(input as { cursor?: string }).cursor
					? { nextCursor: "page-two" }
					: {}),
			}),
		});
		const service = new AppsConnectionService(fake, {} as Db);
		const input = { query: "read", app: "mail", limit: 10 };
		const [first, duplicate] = await Promise.all([
			service.discoverActions("session-a", input),
			service.discoverActions("session-a", input),
		]);
		expect(first).toEqual(duplicate);
		expect(fake.callsTo("apps.catalog.search")).toHaveLength(1);
		expect(first.nextCursor).toBe("page-two");
		const second = await service.discoverActions("session-a", {
			...input,
			cursor: first.nextCursor,
		});
		expect(second.nextCursor).toBeUndefined();
		expect(fake.callsTo("apps.catalog.search")[1]).toEqual({
			...input,
			cursor: "page-two",
		});
		await service.discoverActions("session-b", input);
		await service.discoverActions("session-a", { ...input, query: "list" });
		expect(fake.callsTo("apps.catalog.search")).toHaveLength(4);
	});
	test("discovery failures are not cached or exposed as upstream text", async () => {
		let fail = true;
		const fake = new FakePramaan({
			"apps.catalog.search": () => {
				if (fail) throw new Error("private response");
				return { results: [] };
			},
		});
		const service = new AppsConnectionService(fake, {} as Db);
		await expect(
			service.discoverActions("session", { query: "read" }),
		).rejects.toThrow("Could not discover actions. Try later.");
		fail = false;
		expect(await service.discoverActions("session", { query: "read" })).toEqual(
			{ results: [] },
		);
		expect(fake.calls).toHaveLength(2);
	});
	test("current app/action fields resolve an action without walking more pages", async () => {
		const fake = new FakePramaan({
			"apps.catalog.search": () => ({
				results: [{ app: "mail", action: "MAIL_FETCH" }],
				nextCursor: "more",
			}),
			"apps.action.execute": () => ({
				status: "succeeded",
				output: { rows: [] },
			}),
		});
		const service = new AppsConnectionService(fake, {} as Db);
		expect(
			(await service.executeAction("person", "mail", "fetch")).outcome,
		).toBe("ok");
		expect(fake.callsTo("apps.catalog.search")).toHaveLength(1);
		expect(fake.callsTo("apps.action.execute")[0]).toMatchObject({
			action: "MAIL_FETCH",
		});
		expect(fake.calls[1]?.opts?.idempotencyKey).toBeTruthy();
	});
	test("downloaded file handles go to document parsing without a URL fetch", async () => {
		const fake = new FakePramaan({
			"document.parse": (input) => {
				expect(input).toEqual({ fileId: "file-owned" });
				return { text: "Document text", truncated: false };
			},
		});
		const service = new AppsConnectionService(fake, {} as Db);
		expect(
			await service.readDownloadedFile({
				fileId: "file-owned",
				url: "https://unused.test",
			}),
		).toEqual({ text: "Document text", truncated: false });
		await expect(
			service.readDownloadedFile({ url: "https://unused.test" }),
		).rejects.toThrow("platform file handle");
		expect(fake.calls).toHaveLength(1);
	});
});
