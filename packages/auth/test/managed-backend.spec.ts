import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakePramaan } from "@crm/pramaan/fake";
import {
	ensureManagedBackend,
	managedBackend,
	resetManagedForTests,
	setManagedPramaanForTests,
} from "../src/managed";

const BACKEND = {
	authUrl: "https://managed-auth.example.test",
	jwksUrl: "https://managed-auth.example.test/jwks.json",
};

const PROVISIONED = { ...BACKEND, status: "ready" as const };

const backendFake = (
	calls: { count: number; keys: (string | undefined)[] },
	fail = false,
) => {
	const fake = new FakePramaan({ "auth.backend.get": () => PROVISIONED });
	fake.routeOutcomes({
		get: () => ({ available: true }),
		estimate: () => ({
			canRun: true,
			requiresApproval: false,
			plan: "startup",
			steps: [],
			priceMinMicro: 0,
			priceMaxMicro: 0,
		}),
		run: (_id, input, opts) => {
			calls.count++;
			calls.keys.push(opts?.idempotencyKey);
			if (fail) throw new Error("unavailable");
			return {
				status: "done",
				result: {
					status: "ready",
					allowedDomains: (input as { domains: string[] }).domains,
				},
			};
		},
	});
	return fake;
};

// Refusals are cached briefly; explicit retry can recover.

let stateDir: string;
const realStateDir = process.env.MANAGED_STATE_DIR;

beforeAll(() => {
	stateDir = mkdtempSync(join(tmpdir(), "managed-backend-spec-"));
	process.env.MANAGED_STATE_DIR = stateDir;
});

afterAll(() => {
	rmSync(stateDir, { force: true, recursive: true });
	if (realStateDir === undefined) delete process.env.MANAGED_STATE_DIR;
	else process.env.MANAGED_STATE_DIR = realStateDir;
	resetManagedForTests();
});

describe("the managed backend cache", () => {
	it("returns nothing when there is no client at all", async () => {
		resetManagedForTests();
		setManagedPramaanForTests(null);

		expect(await ensureManagedBackend()).toBeNull();
		expect(managedBackend()).toBeNull();
	});

	it("sets up once, then reuses the cache", async () => {
		resetManagedForTests();
		const calls = { count: 0, keys: [] as (string | undefined)[] };
		setManagedPramaanForTests(backendFake(calls));

		const first = await ensureManagedBackend();
		const second = await ensureManagedBackend();

		expect(first).toEqual(BACKEND);
		expect(second).toEqual(BACKEND);
		expect(managedBackend()).toEqual(BACKEND);
		expect(calls.count).toBe(1);
		expect(calls.keys[0]).toBeTruthy();

		// A later boot sets up again with a new outcome request.
		const nextCalls = { count: 0, keys: [] as (string | undefined)[] };
		resetManagedForTests();
		setManagedPramaanForTests(backendFake(nextCalls));
		await expect(ensureManagedBackend()).resolves.toEqual(BACKEND);
		expect(nextCalls.keys[0]).toBeTruthy();
	});

	it("does not hammer the platform when a provision was refused", async () => {
		resetManagedForTests();
		const calls = { count: 0, keys: [] as (string | undefined)[] };
		setManagedPramaanForTests(backendFake(calls, true));

		await expect(ensureManagedBackend()).resolves.toBeNull();
		await expect(ensureManagedBackend()).resolves.toBeNull();

		expect(calls.count).toBe(1);
		expect(managedBackend()).toBeNull();
	});

	it("retries lazily once the refusal window has passed", async () => {
		resetManagedForTests();
		const calls = { count: 0, keys: [] as (string | undefined)[] };
		setManagedPramaanForTests(backendFake(calls, true));
		await expect(ensureManagedBackend()).resolves.toBeNull();
		expect(calls.count).toBe(1);

		// A later sign-in-options read, a minute on: the retry goes out and —
		// with the key working now — the cache fills.
		const realNow = Date.now;
		Date.now = () => realNow() + 61_000;
		try {
			setManagedPramaanForTests(backendFake(calls));
			await expect(ensureManagedBackend()).resolves.toEqual(BACKEND);
			expect(calls.count).toBe(2);
			expect(managedBackend()).toEqual(BACKEND);
		} finally {
			Date.now = realNow;
		}
	});

	it("force retries immediately and recovers from a broken-key boot", async () => {
		resetManagedForTests();
		const calls = { count: 0, keys: [] as (string | undefined)[] };
		setManagedPramaanForTests(backendFake(calls, true));
		await expect(ensureManagedBackend()).resolves.toBeNull();

		setManagedPramaanForTests(backendFake(calls));
		await expect(
			ensureManagedBackend(undefined, { force: true }),
		).resolves.toEqual(BACKEND);
		expect(managedBackend()).toEqual(BACKEND);
	});
});

describe("origins-only outcome setup", () => {
	it("omits social and test users and reads URLs only after confirmed origins", async () => {
		resetManagedForTests();
		const fake = backendFake({ count: 0, keys: [] });
		setManagedPramaanForTests(fake);
		expect(await ensureManagedBackend()).toEqual(BACKEND);
		const run = fake.outcomeCalls.find((c) => c.verb === "run");
		expect(run?.id).toBe("auth.backend.setup");
		expect(Object.keys(run?.input as object)).toEqual(["domains"]);
		expect(fake.calls.map((c) => c.id)).toEqual(["auth.backend.get"]);
	});
	it("does not expose sign-in when origins are unconfirmed in a partial report", async () => {
		resetManagedForTests();
		const fake = backendFake({ count: 0, keys: [] });
		fake.routeOutcomes({
			run: () => ({
				status: "done",
				completeness: "partial",
				result: { status: "ready" },
			}),
		});
		setManagedPramaanForTests(fake);
		expect(await ensureManagedBackend()).toBeNull();
		expect(fake.calls).toHaveLength(0);
	});
});
