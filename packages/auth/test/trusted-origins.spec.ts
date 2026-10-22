import { describe, expect, it } from "bun:test";
import { computeTrustedOrigins } from "../src/env";

describe("the CSRF trusted origins", () => {
	it("keeps the given origins verbatim", () => {
		expect(
			computeTrustedOrigins(["http://localhost:3000", "http://api:3001"]),
		).toContain("http://api:3001");
	});

	it("aliases loopback hosts so the app works from 127.0.0.1 as well as localhost", () => {
		const trusted = computeTrustedOrigins(["http://localhost:3000"]);

		expect(trusted).toContain("http://127.0.0.1:3000");
		expect(trusted).toContain("http://[::1]:3000");
	});

	it("aliases back to localhost when APP_URL names 127.0.0.1", () => {
		const trusted = computeTrustedOrigins(["http://127.0.0.1:3000"]);

		expect(trusted).toContain("http://localhost:3000");
		expect(trusted).toContain("http://[::1]:3000");
	});

	it("keeps the port when aliasing", () => {
		const trusted = computeTrustedOrigins(["http://localhost:3100"]);

		expect(trusted).toContain("http://127.0.0.1:3100");
		expect(trusted).not.toContain("http://127.0.0.1:3000");
	});

	it("never aliases a non-loopback origin", () => {
		const trusted = computeTrustedOrigins(["http://crm.example.com"]);

		expect(trusted).toEqual(["http://crm.example.com"]);
	});

	it("deduplicates", () => {
		const trusted = computeTrustedOrigins([
			"http://localhost:3000",
			"http://127.0.0.1:3000",
		]);

		expect(trusted).toEqual([
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://[::1]:3000",
		]);
	});
});
