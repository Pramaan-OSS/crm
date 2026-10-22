import { expect, test } from "bun:test";
import { PramaanClient } from "../src/index";

test("stream refusals retain the server retry delay", async () => {
	const client = new PramaanClient({
		apiKey: "fake",
		fetch: async () =>
			Response.json(
				{ error: { code: "rate_limited", retryable: true } },
				{ status: 429, headers: { "Retry-After": "6" } },
			),
	});
	await expect(client.llmChatStream({}).next()).rejects.toMatchObject({
		code: "rate_limited",
		retryAfterMs: 6000,
	});
});

test("a read retry reservation conflict keeps the first refusal", async () => {
	let reads = 0;
	const client = new PramaanClient({
		apiKey: "fake",
		sleep: async () => {},
		fetch: async () => {
			reads++;
			return Response.json(
				{
					error: {
						code: reads === 1 ? "upstream_unavailable" : "conflict",
						retryable: true,
					},
				},
				{ status: reads === 1 ? 503 : 409 },
			);
		},
	});
	await expect(client.jobs.get("owned-job")).rejects.toMatchObject({
		code: "upstream_unavailable",
		status: 503,
	});
	expect(reads).toBe(2);
});

test("a successful read clears earlier retry metadata before decoding", async () => {
	let reads = 0;
	const client = new PramaanClient({
		apiKey: "fake",
		sleep: async () => {},
		fetch: async () =>
			++reads === 1
				? Response.json(
						{ error: { code: "upstream_unavailable", retryable: true } },
						{ status: 503 },
					)
				: Response.json({}),
	});
	await expect(client.jobs.get("owned-job")).rejects.toMatchObject({
		code: "internal",
	});
	expect(reads).toBe(2);
});
