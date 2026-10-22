import { describe, expect, test } from "bun:test";
import { FakePramaan } from "../src/fake.ts";
import {
	Cap,
	createPramaan,
	idempotencyKey,
	pramaanFromEnv,
} from "../src/index.ts";
import { PramaanError } from "../src/sdk/errors.ts";

describe("pramaanFromEnv", () => {
	test("returns null without a key", () => {
		const saved = process.env.PRAMAAN_API_KEY;
		delete process.env.PRAMAAN_API_KEY;
		try {
			expect(pramaanFromEnv()).toBeNull();
			process.env.PRAMAAN_API_KEY = "  ";
			expect(pramaanFromEnv()).toBeNull();
		} finally {
			if (saved !== undefined) process.env.PRAMAAN_API_KEY = saved;
			else delete process.env.PRAMAAN_API_KEY;
		}
	});

	test("PRAMAAN_FAKE=1 answers without the network", async () => {
		const savedKey = process.env.PRAMAAN_API_KEY;
		const savedFake = process.env.PRAMAAN_FAKE;
		process.env.PRAMAAN_API_KEY = "dummy-key-for-a-smoke-test";
		process.env.PRAMAAN_FAKE = "1";
		try {
			const client = pramaanFromEnv();
			expect(client).not.toBeNull();
			await expect(client?.webSearch({ query: "crm" })).rejects.toThrow(
				/Could not reach/,
			);
		} finally {
			if (savedKey !== undefined) process.env.PRAMAAN_API_KEY = savedKey;
			else delete process.env.PRAMAAN_API_KEY;
			if (savedFake !== undefined) process.env.PRAMAAN_FAKE = savedFake;
			else delete process.env.PRAMAAN_FAKE;
		}
	});

	test("builds a client from a key, and honours a base url", async () => {
		let seen: { url: string; init: RequestInit } | null = null;
		const p = createPramaan({
			apiKey: "sk_live_test",
			baseUrl: "https://pramaan.test",
			fetch: async (url, init) => {
				seen = { url, init };
				return new Response(
					JSON.stringify({ results: [{ title: "t", url: "u", snippet: "s" }] }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			},
		});
		const out = await p.webSearch({ query: "crm" });
		expect(out.results[0]?.title).toBe("t");
		const request = seen as unknown as { url: string; init: RequestInit };
		expect(request.url).toBe("https://pramaan.test/v1/capabilities/web.search");
		expect(new Headers(request.init.headers).get("Authorization")).toBe(
			"Bearer sk_live_test",
		);
	});

	test("never retries an external call, always retries a read_only one", async () => {
		let attempts = 0;
		const flaky = () =>
			createPramaan({
				apiKey: "k",
				sleep: async () => {},
				fetch: async () => {
					attempts += 1;
					return new Response(
						JSON.stringify({
							error: { code: "rate_limited", message: "slow down" },
						}),
						{ status: 429, headers: { "content-type": "application/json" } },
					);
				},
			});
		const read = flaky();
		await read.exchangeRate({ from: "USD", to: "EUR" }).catch(() => null);
		expect(attempts).toBe(3); // 1 + maxRetries(2)

		attempts = 0;
		const external = flaky();
		await external
			.emailSend({ from: "a@b.c", to: "d@e.f", subject: "s", text: "x" })
			.catch(() => null);
		expect(attempts).toBe(1);
	});

	test("Pramaan-Fresh is sent only when fresh is set", async () => {
		const seen: (string | undefined)[] = [];
		const make = (fresh: boolean) =>
			createPramaan({
				apiKey: "k",
				fetch: async (_url, init) => {
					seen.push(
						new Headers(init.headers).get("Pramaan-Fresh") ?? undefined,
					);
					return new Response(
						JSON.stringify({
							results: [{ title: "t", url: "u", snippet: "s" }],
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				},
			});

		const person = make(true);
		await person.webSearch({ query: "fresh" }, { fresh: true });
		const background = make(false);
		await background.webSearch({ query: "cached" });

		expect(seen[0]).toBe("1");
		expect(seen[1]).toBeUndefined();
	});
	test("routes calls and records them", async () => {
		const fake = new FakePramaan({
			[Cap.companiesEnrich]: () => ({
				name: "Fernhill",
				domain: "fernhill.example",
			}),
			[Cap.webAnswers]: () => ({ answer: "42", sources: [], truncated: false }),
		});
		const out = await fake.companiesEnrich({ domain: "fernhill.example" });
		expect(out.name).toBe("Fernhill");
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]?.id).toBe("companies.enrich");
	});

	test("throws loudly on an unrouted capability", () => {
		const fake = new FakePramaan();
		expect(fake.peopleEnrich({ email: "a@b.c" })).rejects.toThrow(
			/no route for "people.enrich"/,
		);
	});

	test("errors keep the platform error code", () => {
		const error = new PramaanError("rate_limited", "slow down", {
			retryable: true,
		});
		expect(error.code).toBe("rate_limited");
		expect(error.retryable).toBe(true);
	});
});
