import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPramaan } from "@crm/pramaan";
import { FakePramaan } from "@crm/pramaan/fake";
import { createPramaanChatModel } from "../agent/lib/pramaan-chat-model";
import { agentTransport } from "../agent/lib/pramaan-transport";
import {
	createSpendLedger,
	newPaidRun,
	reserveSpend,
} from "../agent/lib/run-safety";

const saved = process.env.DATABASE_URL;
const cap = process.env.AGENT_MAX_SPEND_MICRO;
const roots: string[] = [];
afterEach(() => {
	if (saved === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = saved;
	if (cap === undefined) delete process.env.AGENT_MAX_SPEND_MICRO;
	else process.env.AGENT_MAX_SPEND_MICRO = cap;
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const json = (body: unknown, status = 200, headers = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
const limited = () =>
	json(
		{
			error: {
				code: "rate_limited",
				message: "Retry after 11 seconds",
				retryable: true,
			},
		},
		429,
		{ "retry-after": "11" },
	);
function harness(fetch: (url: string, init: RequestInit) => Promise<Response>) {
	process.env.DATABASE_URL = "postgresql://fake:fake@localhost/transport_test";
	process.env.AGENT_MAX_SPEND_MICRO = "100";
	const root = mkdtempSync(join(tmpdir(), "crm-transport-"));
	roots.push(root);
	const run = newPaidRun();
	createSpendLedger(root, run);
	const waits: number[] = [];
	return {
		waits,
		client: createPramaan({
			apiKey: "fake",
			fetch: agentTransport({
				fetch,
				run: () => run,
				reserve: (r, amount) => reserveSpend(root, r, amount),
				wait: async (ms) => {
					waits.push(ms);
				},
			}),
		}),
	};
}

test("tool capability waits 11 seconds, preserves request and caps later calls before payment", async () => {
	const fake = new FakePramaan({ "web.search": () => ({ results: [] }) });
	let paid = 0;
	const headers: Headers[] = [];
	const { client, waits } = harness(async (url, init) => {
		if (url.endsWith("/estimate")) return json({ price_max_micro: 60 });
		headers.push(new Headers(init.headers));
		if (++paid === 1) return limited();
		return json(await fake.webSearch(JSON.parse(String(init.body))));
	});
	await client.webSearch({ query: "company facts" });
	expect(waits).toEqual([11_000]);
	expect(paid).toBe(2);
	expect(headers.map((h) => h.get("Pramaan-Max-Price-Micro"))).toEqual([
		"60",
		"60",
	]);
	await expect(client.webSearch({ query: "more facts" })).rejects.toThrow(
		"spending limit",
	);
	expect(paid).toBe(2);
	expect(fake.calls).toHaveLength(1);
});

test("outcomes and free job reads share bounded waits without duplicating accepted work", async () => {
	let outcome = 0;
	let reads = 0;
	const { client, waits } = harness(async (url, init) => {
		if (url.endsWith("/estimate"))
			return json({ price_max_micro: 30, plan: "plan_test" });
		if (url.includes("/jobs/")) {
			if (++reads === 1) return limited();
			return json({ job_id: "job_test", status: "done", result: {} });
		}
		expect(new Headers(init.headers).get("Pramaan-Plan")).toBe("plan_test");
		if (++outcome === 1) return limited();
		return json({
			outcome: "company.research",
			plan: "plan_test",
			status: "done",
			cost: {},
			result: {},
		});
	});
	await client.outcomes.run("company.research", { domain: "example.test" });
	await client.jobs.get("job_test");
	expect(waits).toEqual([11_000, 11_000]);
	expect(outcome).toBe(2);
	expect(reads).toBe(2);
});

test("transport and model together perform only two waits, including streams", async () => {
	for (const stream of [false, true]) {
		let paid = 0;
		const { client, waits } = harness(async (url) => {
			if (url.endsWith("/estimate")) return json({ price_max_micro: 30 });
			paid++;
			return limited();
		});
		const model = createPramaanChatModel({
			pramaan: client,
			waitForRateLimit: async () => {
				throw new Error("Nested retry");
			},
		});
		const prompt = [{ role: "user", content: "Research" }];
		if (stream) {
			const result = await model.doStream({ prompt });
			const parts = await Array.fromAsync(result.stream);
			expect(parts.some((part) => part.type === "error")).toBe(true);
		} else
			await expect(model.doGenerate({ prompt })).rejects.toThrow("Retry after");
		expect(waits).toEqual([11_000, 11_000]);
		expect(paid).toBe(3);
	}
});

test("unbounded estimates and missing run state cannot make a paid call", async () => {
	let paid = 0;
	const { client } = harness(async (url) => {
		if (url.endsWith("/estimate")) return json({});
		paid++;
		return json({});
	});
	await expect(client.webSearch({ query: "facts" })).rejects.toThrow("bounded");
	expect(paid).toBe(0);
	const transport = agentTransport({
		fetch: async () => {
			throw new Error("Must not reach transport");
		},
		run: () => null,
		reserve: () => {},
	});
	await expect(
		transport("https://example.test/v1/capabilities/web.search", {
			method: "POST",
		}),
	).rejects.toThrow("untrusted");
});

test("a fresh estimate cannot approve an outcome or replace a person's changed plan", async () => {
	for (const approved of [undefined, "plan_old"]) {
		let paid = 0;
		const { client } = harness(async (url) => {
			if (url.endsWith("/estimate"))
				return json({
					price_max_micro: 30,
					plan: "plan_new",
					requires_approval: true,
				});
			paid++;
			return json({});
		});
		await expect(
			client.outcomes.run("company.research", {}, { plan: approved }),
		).rejects.toThrow(approved ? "changed" : "approve");
		expect(paid).toBe(0);
	}
});
