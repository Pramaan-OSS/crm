// The managed Postgres database (db.postgres.provision), used when the install
// has a key and has not set DATABASE_URL itself. The connection address is
// shown once by the platform, so it is stored in the git-ignored .runtime
// folder with mode 0600 and never logged. When the platform cannot serve a
// database yet, this falls back to the bundled local Postgres — the same code
// path either way; only the connection string differs.

import "@crm/env/load";

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	idempotencyKey,
	type Pramaan,
	PramaanError,
	pramaanFromEnv,
} from "@crm/pramaan";

export type ManagedDatabaseOutcome = {
	/** True when the managed database's address is in DATABASE_URL for this boot. */
	readonly managed: boolean;
	/** "saved": reused the address stored by an earlier boot. "new": provisioned now. */
	readonly from?: "saved" | "new";
	/** Why the local bundled Postgres is serving instead. */
	readonly localReason?: "no-key" | "unavailable" | "refused" | "own-url";
	/** Plain platform reason, for the one-line startup note. No secrets. */
	readonly reason?: string;
};

function managedUrlFile(): string | null {
	const root = process.env.MANAGED_STATE_DIR;
	if (root) return join(root, "managed-db-url");
	// The workspace root's ignored .runtime folder.
	let directory = process.cwd();
	for (;;) {
		if (existsSync(join(directory, "package.json"))) {
			try {
				const parsed: unknown = JSON.parse(
					readFileSync(join(directory, "package.json"), "utf8"),
				);
				if (
					parsed instanceof Object &&
					"workspaces" in parsed &&
					parsed.workspaces !== undefined
				) {
					return join(directory, ".runtime", "managed-db-url");
				}
			} catch {
				// unreadable manifest; keep walking
			}
		}
		const parent = directory.replace(/\/[^/]+\/?$/, "");
		if (parent === directory || parent === "") return null;
		directory = parent;
	}
}

/** The address saved by an earlier boot, if any. Sync, cheap, never logged. */
export function readManagedDatabaseUrl(): string | null {
	const file = managedUrlFile();
	if (!file || !existsSync(file)) return null;
	try {
		const value = readFileSync(file, "utf8").trim();
		return value.startsWith("postgresql://") ? value : null;
	} catch {
		return null;
	}
}

function saveManagedDatabaseUrl(url: string): void {
	const file = managedUrlFile();
	if (!file) return;
	try {
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, `${url}\n`, { mode: 0o600 });
		chmodSync(file, 0o600);
	} catch {
		// A read-only tree keeps the address in memory for this boot only.
	}
}

/** Tests inject a fake client here; the next call re-resolves. */
let injectedForTests: Pramaan | null | undefined;

export function setManagedDbPramaanForTests(client: Pramaan | null): void {
	injectedForTests = client;
}

function client(): Pramaan | null {
	if (injectedForTests !== undefined) return injectedForTests;
	return pramaanFromEnv();
}

/**
 * Decide this boot's DATABASE_URL when the person has not set one. Sets
 * process.env.DATABASE_URL on success. Idempotent on the platform side, so
 * every boot may call it; the address itself is written once, never printed.
 */
export async function ensureDatabaseUrl(): Promise<ManagedDatabaseOutcome> {
	if (process.env.DATABASE_URL?.trim()) {
		return { managed: false, localReason: "own-url" };
	}

	const saved = readManagedDatabaseUrl();
	if (saved) {
		process.env.DATABASE_URL = saved;
		return { managed: true, from: "saved" };
	}

	const api = client();
	if (!api) return { managed: false, localReason: "no-key" };

	try {
		const result = await api.dbPostgresProvision({
			idempotencyKey: idempotencyKey(),
		});
		const url = result.connectionString ?? result.directConnectionString;
		if (result.status === "ready" && url) {
			saveManagedDatabaseUrl(url);
			process.env.DATABASE_URL = url;
			return { managed: true, from: "new" };
		}
		// An existing database answers a new key without secrets; with no saved
		// address (another machine wiped .runtime), only rotation can recover
		// it — fall back to local rather than guess.
		return { managed: false, localReason: "refused" };
	} catch (error) {
		return {
			managed: false,
			localReason: "unavailable",
			reason: reasonOf(error),
		};
	}
}

/** The one plain line for the boot log when the local database is serving. */
export function managedDatabaseFallbackLine(
	outcome: ManagedDatabaseOutcome,
): string | null {
	if (outcome.managed) return null;
	if (outcome.localReason === "unavailable") {
		return `Managed database is not available yet (${outcome.reason ?? "unknown reason"}) — using the bundled local Postgres.`;
	}
	if (outcome.localReason === "refused") {
		return `Managed database could not be opened from this machine (${outcome.reason ?? "unknown reason"}) — using the bundled local Postgres.`;
	}
	return null;
}

function reasonOf(error: unknown): string {
	if (error instanceof PramaanError) {
		return `${error.code}: ${error.message}`;
	}
	return error instanceof Error ? error.message : "unknown error";
}

export function resetManagedDbForTests(): void {
	injectedForTests = undefined;
}
