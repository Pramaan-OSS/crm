import { describe, expect, test } from "bun:test";
import { FakePramaan } from "../src/fake.ts";
import { Cap, PramaanError } from "../src/index.ts";

const BACKEND = {
	status: "ready" as const,
	authUrl: "https://managed-auth.example.test",
	jwksUrl: "https://managed-auth.example.test/jwks.json",
};

describe("the managed sign-in backend", () => {
	test("refuses provision without an Idempotency-Key, the way production does", async () => {
		const fake = new FakePramaan({
			[Cap.authBackendProvision]: () => BACKEND,
		});

		expect(fake.authBackendProvision()).rejects.toThrow(PramaanError);
		await fake.authBackendProvision().catch((error: PramaanError) => {
			expect(error.code).toBe("invalid_request");
			expect(error.message).toContain("Idempotency-Key");
		});
	});

	test("provision answers the same backend for the same key — reuse, not a second one", async () => {
		let calls = 0;
		const fake = new FakePramaan({
			[Cap.authBackendProvision]: () => {
				calls += 1;
				return BACKEND;
			},
		});

		const first = await fake.authBackendProvision({
			idempotencyKey: "managed-signin-fixed",
		});
		const second = await fake.authBackendProvision({
			idempotencyKey: "managed-signin-fixed",
		});

		expect(first).toEqual(BACKEND);
		expect(second).toEqual(BACKEND);
		expect(calls).toBe(2);
	});

	test("domains.set carries the whole replacement list, with its own key", async () => {
		let seen: { input: unknown; opts: unknown } | null = null;
		const fake = new FakePramaan({
			[Cap.authBackendDomainsSet]: (input, opts) => {
				seen = { input, opts };
				return {
					domains: (input as { domains: string[] }).domains.map((domain) => ({
						domain,
					})),
				};
			},
		});

		const result = await fake.authBackendDomainsSet(
			{ domains: ["https://crm.example.com"] },
			{ idempotencyKey: "domains-key" },
		);

		expect(seen?.input).toEqual({ domains: ["https://crm.example.com"] });
		expect(seen?.opts).toEqual({ idempotencyKey: "domains-key" });
		expect(result.domains).toEqual([{ domain: "https://crm.example.com" }]);
	});

	test("token.verify says who a real token is for", async () => {
		const fake = new FakePramaan({
			[Cap.authTokenVerify]: (input) => ({
				valid: (input as { token: string }).token === "real-token",
				userId: "managed-user-1",
			}),
		});

		const ok = await fake.authTokenVerify({ token: "real-token" });
		expect(ok).toEqual({ valid: true, userId: "managed-user-1" });

		const refused = await fake.authTokenVerify({ token: "forged" });
		expect(refused.valid).toBe(false);
	});

	test("user.get answers the profile the exchange needs", async () => {
		const fake = new FakePramaan({
			[Cap.authUserGet]: (input) => ({
				userId: (input as { userId: string }).userId,
				email: "rep@acme.com",
				emailVerified: true,
				name: "Rep",
			}),
		});

		const profile = await fake.authUserGet({ userId: "managed-user-1" });
		expect(profile.email).toBe("rep@acme.com");
	});
});

describe("the managed Postgres database", () => {
	test("provision refuses without a key, returns the address once, then an existing database without secrets", async () => {
		let calls = 0;
		const fake = new FakePramaan({
			[Cap.dbPostgresProvision]: () => {
				calls += 1;
				if (calls === 1) {
					return {
						status: "ready",
						created: true,
						database: "app",
						role: "app_owner",
						connectionString: "postgresql://app:secret@managed/db/app",
						directConnectionString:
							"postgresql://app:secret@managed-direct/db/app",
					};
				}
				return {
					status: "ready",
					created: false,
					database: "app",
					role: "app_owner",
				};
			},
		});

		await expect(fake.dbPostgresProvision()).rejects.toThrow(/Idempotency-Key/);
		expect(calls).toBe(0);

		const first = await fake.dbPostgresProvision({
			idempotencyKey: "db-attempt-1",
		});
		expect(first.created).toBe(true);
		expect(first.connectionString).toContain("postgresql://");

		const second = await fake.dbPostgresProvision({
			idempotencyKey: "db-attempt-2",
		});
		expect(second.created).toBe(false);
		expect(second.connectionString).toBeUndefined();
	});

	test("an unavailable database surfaces the platform's error code for the fallback", async () => {
		const fake = new FakePramaan({
			[Cap.dbPostgresProvision]: () => {
				throw new PramaanError("upstream_unavailable", "not served yet", {
					retryable: false,
				});
			},
		});

		try {
			await fake.dbPostgresProvision({ idempotencyKey: "db-attempt-1" });
			throw new Error("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(PramaanError);
			expect((error as PramaanError).code).toBe("upstream_unavailable");
		}
	});
});
