import { expect, test } from "bun:test";
import { PramaanError, createPramaan } from "@crm/pramaan";
import { FakePramaan } from "@crm/pramaan/fake";
import { createPramaanChatModel } from "../agent/lib/pramaan-chat-model";

const prompt = [{ role: "user", content: "Research." }];
const reply = {
	text: "Found.",
	toolCalls: [],
	finishReason: "stop",
	usage: { inputTokens: 1, outputTokens: 1 },
};
const limited = () =>
	new PramaanError("rate_limited", "Try later.", {
		retryable: true,
		retryAfterMs: 30_000,
		status: 429,
	});
for (const streamed of [false, true]) {
	test(`explicit rate-limit refusal honours the server wait and then succeeds (${streamed})`, async () => {
		let attempts = 0;
		const waits: number[] = [];
		const fake = new FakePramaan({
			"llm.chat": () => {
				if (++attempts === 1) throw limited();
				return reply;
			},
		});
		fake.routeStream(async function* () {
			if (++attempts === 1) throw limited();
			yield { type: "done", result: reply };
		});
		const model = createPramaanChatModel({
			pramaan: fake,
			waitForRateLimit: async (ms) => {
				waits.push(ms);
			},
		});
		if (streamed) {
			const { stream } = await model.doStream({ prompt });
			expect(
				(await Array.fromAsync(stream)).some((part) => part.type === "error"),
			).toBe(false);
		} else await model.doGenerate({ prompt });
		expect(waits).toEqual([30_000]);
		expect(attempts).toBe(2);
	});
	test(`a step performs at most two waits before remaining failed (${streamed})`, async () => {
		const waits: number[] = [];
		const fake = new FakePramaan({
			"llm.chat": () => {
				throw limited();
			},
		});
		fake.routeStream(async function* () {
			throw limited();
		});
		const model = createPramaanChatModel({
			pramaan: fake,
			waitForRateLimit: async (ms) => {
				waits.push(ms);
			},
		});
		if (streamed) {
			const { stream } = await model.doStream({ prompt });
			expect(
				(await Array.fromAsync(stream)).some((part) => part.type === "error"),
			).toBe(true);
			expect(fake.streamCalls).toHaveLength(3);
			expect(fake.calls).toHaveLength(0);
		} else {
			await expect(model.doGenerate({ prompt })).rejects.toThrow("Try later");
			expect(fake.calls).toHaveLength(3);
		}
		expect(waits).toEqual([30_000, 30_000]);
	});
}
test("unavailable, nonretryable, missing or excessive delays never trigger a retry", async () => {
	for (const error of [
		new PramaanError(
			"upstream_unavailable",
			"The model service is unavailable",
			{ retryable: false, retryAfterMs: 1000 },
		),
		new PramaanError("upstream_unavailable", "Unavailable", {
			retryable: true,
			retryAfterMs: 1000,
		}),
		new PramaanError("rate_limited", "Try later", {
			retryable: false,
			retryAfterMs: 1000,
		}),
		new PramaanError("rate_limited", "Try later", { retryable: true }),
		new PramaanError("rate_limited", "Try later", {
			retryable: true,
			retryAfterMs: 60_001,
		}),
	]) {
		const fake = new FakePramaan({
			"llm.chat": () => {
				throw error;
			},
		});
		let waits = 0;
		await expect(
			createPramaanChatModel({
				pramaan: fake,
				waitForRateLimit: async () => {
					waits++;
				},
			}).doGenerate({ prompt }),
		).rejects.toThrow();
		expect(fake.calls).toHaveLength(1);
		expect(waits).toBe(0);
	}
});
test("a rate-limit error after any stream event cannot resend", async () => {
	const fake = new FakePramaan();
	fake.routeStream(async function* () {
		yield { type: "text_delta", text: "Found" };
		throw limited();
	});
	let waits = 0;
	const { stream } = await createPramaanChatModel({
		pramaan: fake,
		waitForRateLimit: async () => {
			waits++;
		},
	}).doStream({ prompt });
	expect(
		(await Array.fromAsync(stream)).some((part) => part.type === "error"),
	).toBe(true);
	expect(fake.streamCalls).toHaveLength(1);
	expect(fake.calls).toHaveLength(0);
	expect(waits).toBe(0);
});
test("a scripted HTTP refusal carries Retry-After through to the model wait", async () => {
	let calls = 0;
	const waits: number[] = [];
	const client = createPramaan({
		apiKey: "fake",
		fetch: async () => {
			if (++calls === 1)
				return new Response(
					JSON.stringify({
						error: {
							code: "rate_limited",
							retryable: true,
							message: "Try later.",
						},
					}),
					{
						status: 429,
						headers: {
							"retry-after": "45",
							"content-type": "application/json",
						},
					},
				);
			return new Response(JSON.stringify(reply), {
				headers: { "content-type": "application/json" },
			});
		},
	});
	await createPramaanChatModel({
		pramaan: client,
		waitForRateLimit: async (ms) => {
			waits.push(ms);
		},
	}).doGenerate({ prompt });
	expect(calls).toBe(2);
	expect(waits).toEqual([45_000]);
});
