import { expect, test } from "bun:test";
import { errorFromResponse } from "../src/sdk/errors";
for (const [header, milliseconds] of [
	["45", 45000],
	["invalid", undefined],
	["-1", undefined],
] as const)
	test(`Retry-After ${header} is parsed without inventing a delay`, async () => {
		const error = await errorFromResponse(
			new Response(
				JSON.stringify({ error: { code: "rate_limited", retryable: false } }),
				{ status: 429, headers: { "retry-after": header } },
			),
		);
		expect(error.retryAfterMs).toBe(milliseconds);
		expect(error.retryable).toBe(false);
	});
test("an HTTP-date Retry-After is honoured", async () => {
	const before = Date.now();
	const date = new Date(before + 30000).toUTCString();
	const error = await errorFromResponse(
		new Response("", { status: 429, headers: { "retry-after": date } }),
	);
	expect(error.retryAfterMs).toBeGreaterThan(28000);
	expect(error.retryAfterMs).toBeLessThanOrEqual(30000);
});
