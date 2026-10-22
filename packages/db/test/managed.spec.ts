import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PramaanError } from "@crm/pramaan";
import { FakePramaan } from "@crm/pramaan/fake";
import {
	ensureDatabaseUrl,
	managedDatabaseFallbackLine,
	readManagedDatabaseUrl,
	resetManagedDbForTests,
	setManagedDbPramaanForTests,
} from "../src/managed";

const SECRET_URL = "postgresql://app:one-time@managed-db.example.test/app";

const fake = (behavior: "created" | "existing" | "unavailable") =>
	new FakePramaan({
		"db.postgres.provision": () => {
			if (behavior === "created") {
				return {
					status: "ready",
					created: true,
					database: "app",
					role: "app_owner",
					connectionString: SECRET_URL,
				};
			}
			if (behavior === "existing") {
				return {
					status: "ready",
					created: false,
					database: "app",
					role: "app_owner",
				};
			}
			throw new PramaanError("upstream_unavailable", "not served yet", {
				retryable: false,
			});
		},
	});

let stateDir: string;
const realUrl = process.env.DATABASE_URL;

beforeEach(() => {
	stateDir = mkdtempSync(join(tmpdir(), "managed-db-spec-"));
	process.env.MANAGED_STATE_DIR = stateDir;
	delete process.env.DATABASE_URL;
	resetManagedDbForTests();
});

afterAll(() => {
	rmSync(stateDir, { force: true, recursive: true });
	if (realUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = realUrl;
	delete process.env.MANAGED_STATE_DIR;
	resetManagedDbForTests();
});

describe("which database serves this boot", () => {
	it("stays local when there is no key", async () => {
		setManagedDbPramaanForTests(null);

		const outcome = await ensureDatabaseUrl();

		expect(outcome).toEqual({ managed: false, localReason: "no-key" });
		expect(process.env.DATABASE_URL).toBeUndefined();
		expect(managedDatabaseFallbackLine(outcome)).toBeNull();
	});

	it("keeps a database the person chose themselves", async () => {
		process.env.DATABASE_URL =
			"postgresql://postgres:postgres@localhost:54329/crm?schema=public";
		setManagedDbPramaanForTests(fake("created"));

		const outcome = await ensureDatabaseUrl();

		expect(outcome).toEqual({ managed: false, localReason: "own-url" });
		expect(process.env.DATABASE_URL).not.toBe(SECRET_URL);
	});

	it("saves the one-time address with mode 0600 and never returns it twice", async () => {
		setManagedDbPramaanForTests(fake("created"));

		const outcome = await ensureDatabaseUrl();

		expect(outcome).toEqual({ managed: true, from: "new" });
		expect(process.env.DATABASE_URL).toBe(SECRET_URL);

		const file = join(stateDir, "managed-db-url");
		expect(existsSync(file)).toBe(true);
		expect((statSync(file).mode & 0o777).toString(8)).toBe("600");

		// A second boot reads the saved address and never calls the platform.
		delete process.env.DATABASE_URL;
		setManagedDbPramaanForTests(
			new FakePramaan({
				"db.postgres.provision": () => {
					throw new Error("the saved address must be used before provisioning");
				},
			}),
		);

		const reused = await ensureDatabaseUrl();
		expect(reused).toEqual({ managed: true, from: "saved" });
		expect(process.env.DATABASE_URL).toBe(SECRET_URL);
	});

	it("falls back to the bundled local database with one plain line when not served yet", async () => {
		setManagedDbPramaanForTests(fake("unavailable"));

		const outcome = await ensureDatabaseUrl();

		expect(outcome.managed).toBe(false);
		expect(outcome.localReason).toBe("unavailable");
		expect(outcome.reason).toContain("upstream_unavailable");
		expect(process.env.DATABASE_URL).toBeUndefined();
		expect(readManagedDatabaseUrl()).toBeNull();
		const line = managedDatabaseFallbackLine(outcome) as string;
		expect(line).toContain("local Postgres");
		expect(line).toContain("upstream_unavailable");
	});

	it("falls back rather than guessing when an existing database has no address to give", async () => {
		setManagedDbPramaanForTests(fake("existing"));

		const outcome = await ensureDatabaseUrl();

		expect(outcome).toEqual({ managed: false, localReason: "refused" });
		expect(managedDatabaseFallbackLine(outcome)).toContain("local Postgres");
	});
});
