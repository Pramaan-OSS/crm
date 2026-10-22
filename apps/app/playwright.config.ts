import { execSync } from "node:child_process";
import { defineConfig } from "@playwright/test";

const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;

// Leftover dev processes make the webServer start fail (eve refuses a second
// instance, the port is already taken), so clear them before the stack comes up.
export default defineConfig({
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	timeout: 180_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	reporter: [["line"]],
	use: {
		baseURL: BASE,
		headless: true,
		trace: "retain-on-failure",
	},
	webServer: {
		command: "bun ./apps/app/e2e/dev-stack.ts",
		cwd: "../..",
		url: BASE,
		reuseExistingServer: !process.env.CI,
		timeout: 300_000,
		env: {
			...process.env,
			// A fresh install with nothing configured: the specs below assert what
			// that state looks like, and the records spec signs in through a seeded
			// session cookie rather than a provider.
			ALLOWED_SIGN_IN: "example.com",
			BETTER_AUTH_SECRET: "playwright-secret-at-least-32-characters-long",
			DATABASE_URL:
				"postgresql://postgres:postgres@localhost:54329/crm?schema=public",
			GOOGLE_CLIENT_ID: "",
			MICROSOFT_CLIENT_ID: "",
			PRAMAAN_API_KEY: "",
			AGENT_BRIDGE_SECRET: "playwright-bridge-secret",
			API_URL: "http://127.0.0.1:3101",
			NEXT_PUBLIC_API_URL: "http://127.0.0.1:3101",
		},
	},
});
