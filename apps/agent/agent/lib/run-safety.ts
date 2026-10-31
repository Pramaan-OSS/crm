import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { PramaanError } from "@crm/pramaan";

export function positiveSetting(name: string, fallback: number): number {
	const value = Number(process.env[name] ?? fallback);
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new Error(`${name} must be a positive whole number.`);
	return value;
}
export function databaseScope(databaseUrl = process.env.DATABASE_URL): string {
	if (!databaseUrl)
		throw new Error("DATABASE_URL must be resolved before starting the agent.");
	return createHash("sha256").update(databaseUrl).digest("hex");
}
export function maxSessionAgeMs(): number {
	return positiveSetting("AGENT_MAX_SESSION_AGE_MS", 3_600_000);
}
export type PaidRun = {
	id: string;
	database: string;
	createdAt: number;
	cap: number;
};
export function newPaidRun(now = Date.now()): PaidRun {
	return {
		id: randomUUID(),
		database: databaseScope(),
		createdAt: now,
		cap: positiveSetting("AGENT_MAX_SPEND_MICRO", 100_000),
	};
}
export function assertCurrentRun(
	run: PaidRun | null,
	now = Date.now(),
): asserts run is PaidRun {
	if (
		!run ||
		run.database !== databaseScope() ||
		!Number.isFinite(run.createdAt) ||
		run.createdAt > now ||
		now - run.createdAt > maxSessionAgeMs()
	)
		throw new Error(
			"This saved agent session is untrusted or expired. Start a new run.",
		);
}

/** Never mutate Eve data: an untrusted queue stops startup for manual review. */
export function checkQueuedSessionScope(
	appRoot: string,
	now = Date.now(),
): void {
	const runtime = join(appRoot, ".runtime");
	const marker = join(runtime, "queue-scope.json");
	const queue = join(appRoot, ".eve", ".workflow-data");
	const queued = existsSync(queue) && readdirSync(queue).length > 0;
	if (queued) {
		const scope: PaidRun | null = existsSync(marker)
			? JSON.parse(readFileSync(marker, "utf8"))
			: null;
		assertCurrentRun(scope, now);
		return;
	}
	mkdirSync(runtime, { recursive: true });
	writeFileSync(marker, JSON.stringify(newPaidRun(now)), { mode: 0o600 });
}

export function spendLedgerRoot(): string {
	const root = process.env.AGENT_RUNTIME_ROOT;
	if (!root)
		throw new Error(
			"Start the agent through its package scripts to enable spending controls.",
		);
	return resolve(root, "agent-spend");
}

export function createSpendLedger(root: string, run: PaidRun): void {
	assertCurrentRun(run);
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, `${run.id}.json`), "0", { mode: 0o600, flag: "wx" });
}

/** Reserve worst-case cost, never refund uncertainty. A lock also covers parallel tools/processes. */
export function reserveSpend(
	root: string,
	run: PaidRun | null,
	amount: number,
): void {
	assertCurrentRun(run);
	if (!Number.isSafeInteger(amount) || amount < 0)
		throw new Error("The research cost could not be bounded.");
	if (!/^[a-f0-9-]{36}$/.test(run.id))
		throw new Error("Invalid agent run reference.");
	mkdirSync(root, { recursive: true });
	const path = join(root, `${run.id}.json`);
	const lock = `${path}.lock`;
	try {
		mkdirSync(lock);
	} catch {
		throw new Error(
			"Another call is reserving this run's budget. Retry the step manually.",
		);
	}
	try {
		if (!existsSync(path))
			throw new Error(
				"This run's spending record is missing. Review the saved session before starting again.",
			);
		const used = JSON.parse(readFileSync(path, "utf8")) as number;
		const cap = Math.min(
			run.cap,
			positiveSetting("AGENT_MAX_SPEND_MICRO", 100_000),
		);
		if (
			!Number.isSafeInteger(used) ||
			used < 0 ||
			!Number.isSafeInteger(cap) ||
			used + amount > cap
		)
			throw new PramaanError(
				"spend_cap_reached",
				"This agent run reached its spending limit. Start a new run only after reviewing it.",
			);
		writeFileSync(`${path}.tmp`, String(used + amount), { mode: 0o600 });
		renameSync(`${path}.tmp`, path);
	} finally {
		rmdirSync(lock);
	}
}
