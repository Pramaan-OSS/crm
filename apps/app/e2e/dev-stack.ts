// The e2e dev stack: starts the app (3100), API (3101) and agent (2000) as one
// foreground process tree, waits until the app answers, then stays up for
// Playwright's webServer. On SIGTERM/SIGINT it takes the tree down.
//
// Run from the repo root: bun apps/app/e2e/dev-stack.ts — all paths derive from
// the working directory, never from import.meta (bun resolves relative entry
// URLs against the invocation directory).

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { killRepoDevServers } from "./kill-dev";

const ROOT = process.cwd();
const APP_DIR = join(ROOT, "apps", "app");
const API_DIR = join(ROOT, "apps", "api");
const AGENT_DIR = join(ROOT, "apps", "agent");
const APP_BIN = join(APP_DIR, "node_modules", ".bin", "next");
const AGENT_BIN = join(AGENT_DIR, "node_modules", ".bin", "eve");

const APP_URL = "http://127.0.0.1:3100";
const READY_TIMEOUT_MS = 240_000;

const children: ChildProcess[] = [];

function start(
	name: string,
	cwd: string,
	command: string,
	args: string[],
): void {
	const child = spawn(command, args, {
		cwd,
		detached: false,
		stdio: ["ignore", "inherit", "inherit"],
		env: process.env,
	});
	children.push(child);
	console.log(`[e2e-stack] started ${name} (${child.pid})`);
}

function teardown(): void {
	for (const child of children) {
		try {
			child.kill("SIGTERM");
		} catch {
			// already gone
		}
	}
	try {
		killRepoDevServers();
	} catch {
		// nothing left
	}
}

process.on("SIGTERM", () => {
	teardown();
	process.exit(0);
});
process.on("SIGINT", () => {
	teardown();
	process.exit(0);
});

if (!existsSync(APP_BIN) || !existsSync(AGENT_BIN)) {
	console.error("[e2e-stack] binaries missing — run bun install first.");
	process.exit(1);
}

killRepoDevServers();

start("api", API_DIR, process.execPath, ["--watch", "src/main.ts"]);
start("agent", AGENT_DIR, AGENT_BIN, ["dev", "--no-ui"]);
start("app", APP_DIR, APP_BIN, ["dev", "-p", "3100"]);

const startedAt = Date.now();
for (;;) {
	try {
		const response = await fetch(`${APP_URL}/sign-in`, {
			signal: AbortSignal.timeout(5_000),
		});
		console.log(
			`[e2e-stack] ready (${response.status}) in ${Math.round((Date.now() - startedAt) / 1000)}s`,
		);
		break;
	} catch {
		if (Date.now() - startedAt > READY_TIMEOUT_MS) {
			console.error("[e2e-stack] the app never became ready.");
			teardown();
			process.exit(1);
		}
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
}

// Hold the tree open for Playwright's webServer.
await new Promise(() => {});
