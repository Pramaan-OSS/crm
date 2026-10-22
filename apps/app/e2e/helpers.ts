// Seed + sign-in helpers for the headless specs. The seeding runs through bun
// (the db client is a bun/TypeScript workspace package), the specs themselves are
// plain Playwright.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Page } from "@playwright/test";

// Playwright runs from apps/app (the config directory), so the repo root is up one.
const REPO_ROOT = join(process.cwd(), "..");
const SEED = join(__dirname, "seed.ts");

const OWNER_EMAIL = "playwright@example.com";

export function seed(
	command: "session" | "company" | "contact" | "deal" | "reset",
): Record<string, unknown> {
	const out = execFileSync("bun", [SEED, command, OWNER_EMAIL], {
		cwd: REPO_ROOT,
		encoding: "utf8",
	});
	const line = out.split("\n").find((l) => l.startsWith("RESULT "));
	if (!line) throw new Error(`Seed produced no RESULT line: ${out}`);
	return JSON.parse(line.slice("RESULT ".length)) as {
		token?: string;
		id?: string;
	};
}

/** A signed-in page: the seeded session token becomes the better-auth cookie. */
export async function signIn(page: Page): Promise<void> {
	const { token } = seed("session") as { token: string };
	await page.context().addCookies([
		{
			name: "crm.session_token",
			value: token,
			domain: "127.0.0.1",
			path: "/",
		},
	]);
}

export const WORKSPACE = "workspace";
