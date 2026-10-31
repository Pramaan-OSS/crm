import { afterEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertCurrentRun,
	checkQueuedSessionScope,
	createSpendLedger,
	newPaidRun,
	reserveSpend,
} from "../agent/lib/run-safety";

const original = { ...process.env };
const roots: string[] = [];
function setup() {
	process.env.DATABASE_URL = "postgresql://fake:fake@localhost/crm_safety_test";
	process.env.AGENT_MAX_SPEND_MICRO = "100";
	process.env.AGENT_MAX_SESSION_AGE_MS = "3600000";
	const root = mkdtempSync(join(tmpdir(), "crm-safety-"));
	roots.push(root);
	return root;
}
afterEach(() => {
	for (const key of [
		"DATABASE_URL",
		"AGENT_MAX_SPEND_MICRO",
		"AGENT_MAX_SESSION_AGE_MS",
	]) {
		if (original[key] === undefined) delete process.env[key];
		else process.env[key] = original[key];
	}
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

test("startup refuses legacy, different database and expired queues without changing them", () => {
	const root = setup();
	const queue = join(root, ".eve", ".workflow-data");
	mkdirSync(queue, { recursive: true });
	const fixture = join(queue, "queued.json");
	writeFileSync(fixture, "old work");
	expect(() => checkQueuedSessionScope(root)).toThrow("untrusted");
	mkdirSync(join(root, ".runtime"));
	const run = newPaidRun();
	writeFileSync(
		join(root, ".runtime", "queue-scope.json"),
		JSON.stringify(run),
	);
	expect(() => checkQueuedSessionScope(root)).not.toThrow();
	process.env.DATABASE_URL += "_different";
	expect(() => checkQueuedSessionScope(root)).toThrow("untrusted");
	process.env.DATABASE_URL = "postgresql://fake:fake@localhost/crm_safety_test";
	expect(() =>
		checkQueuedSessionScope(root, run.createdAt + 3_600_001),
	).toThrow("expired");
	expect(readFileSync(fixture, "utf8")).toBe("old work");
});

test("a fresh queue is scoped without recording the database address", () => {
	const root = setup();
	checkQueuedSessionScope(root);
	const marker = readFileSync(
		join(root, ".runtime", "queue-scope.json"),
		"utf8",
	);
	expect(marker).not.toContain("postgresql");
	assertCurrentRun(JSON.parse(marker));
	expect(() => assertCurrentRun(null)).toThrow();
});

test("reservations survive reload, cap parallel work and cannot reset on uncertainty", async () => {
	const root = setup();
	const run = newPaidRun();
	createSpendLedger(root, run);
	const results = await Promise.allSettled(
		[60, 60].map(async (amount) => reserveSpend(root, run, amount)),
	);
	expect(
		results.filter((result) => result.status === "fulfilled"),
	).toHaveLength(1);
	expect(() => reserveSpend(root, JSON.parse(JSON.stringify(run)), 41)).toThrow(
		"spending limit",
	);
	reserveSpend(root, run, 40);
	expect(() => reserveSpend(root, run, 1)).toThrow("spending limit");
	const missing = newPaidRun();
	expect(() => reserveSpend(root, missing, 1)).toThrow("missing");
	const another = newPaidRun();
	writeFileSync(join(root, `${another.id}.json`), "");
	expect(() => reserveSpend(root, another, 1)).toThrow();
});

test("the installed session context preserves the run and cannot refresh its allowance", async () => {
	const root = setup();
	const previousRoot = process.env.AGENT_RUNTIME_ROOT;
	process.env.AGENT_RUNTIME_ROOT = root;
	try {
		const { ContextContainer, contextStorage } = await import(
			new URL("./context/container.js", import.meta.resolve("eve")).href
		);
		const { default: hook } = await import("../agent/hooks/run-safety");
		const { paidRun } = await import("../agent/lib/paid-run");
		const context = new ContextContainer();
		let id: string;
		await contextStorage.run(context, async () => {
			hook.events["session.started"]();
			hook.events["step.started"]();
			const run = paidRun.get();
			if (!run) throw new Error("Missing session run");
			id = run.id;
			reserveSpend(join(root, "agent-spend"), run, 60);
		});
		const reloaded = new ContextContainer();
		for (const [key, value] of context.entries())
			reloaded.set(key, JSON.parse(JSON.stringify(value)));
		await contextStorage.run(reloaded, async () => {
			hook.events["session.started"]();
			expect(paidRun.get()?.id).toBe(id);
			expect(() =>
				reserveSpend(join(root, "agent-spend"), paidRun.get(), 41),
			).toThrow("spending limit");
		});
	} finally {
		if (previousRoot === undefined) delete process.env.AGENT_RUNTIME_ROOT;
		else process.env.AGENT_RUNTIME_ROOT = previousRoot;
	}
});

test("direct background tasks retain their cap when leased again", async () => {
	const root = setup();
	const previousRoot = process.env.AGENT_RUNTIME_ROOT;
	process.env.AGENT_RUNTIME_ROOT = root;
	try {
		const { directPaidRun, withDirectPaidRun } = await import(
			"../agent/lib/direct-paid-run"
		);
		await withDirectPaidRun("task-offline", async () => {
			reserveSpend(
				join(root, "agent-spend"),
				directPaidRun.getStore() ?? null,
				60,
			);
		});
		await expect(
			withDirectPaidRun("task-offline", async () => {
				reserveSpend(
					join(root, "agent-spend"),
					directPaidRun.getStore() ?? null,
					41,
				);
			}),
		).rejects.toThrow("spending limit");
	} finally {
		if (previousRoot === undefined) delete process.env.AGENT_RUNTIME_ROOT;
		else process.env.AGENT_RUNTIME_ROOT = previousRoot;
	}
});
