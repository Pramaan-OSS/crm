// Streaming (PRA-10) client semantics against a scripted fetch — no network.
// Covers a normal stream, one that ends early, and one that is refused.

import { describe, expect, test } from "bun:test";
import { PramaanClient } from "../src/sdk/client.ts";
import { PramaanError } from "../src/sdk/errors.ts";

const BASE = "https://pramaan.test";

function sse(frames: string[]): Response {
	const body = frames.map((frame) => `${frame}\n\n`).join("");
	return new Response(body, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

function scriptedClient(
	handler: (url: string, init: RequestInit) => Response,
	sleep: () => Promise<void> = async () => {},
) {
	const calls: { url: string; init: RequestInit }[] = [];
	const client = new PramaanClient({
		apiKey: "sk_live_test",
		baseUrl: BASE,
		sleep,
		fetch: async (url, init) => {
			calls.push({ url, init });
			return handler(url, init);
		},
	});
	return { client, calls };
}

const DONE_FRAME =
	'event: done\ndata: {"finishReason":"stop","result":{"text":"Hello.","toolCalls":[],"finishReason":"stop","usage":{"inputTokens":12,"outputTokens":3}},"price_micro":1000}';

describe("llmChatStream", () => {
	test("a normal stream sends Accept: text/event-stream and yields deltas then done", async () => {
		const { client, calls } = scriptedClient(() =>
			sse([
				"event: text_delta\ndata: {\"text\":\"Hel\"}",
				"event: text_delta\ndata: {\"text\":\"lo.\"}",
				'event: usage\ndata: {"inputTokens":12,"outputTokens":3}',
				": ping",
				DONE_FRAME,
			]),
		);
		const events = [];
		for await (const event of client.llmChatStream({
			messages: [{ role: "user", content: "Say hello." }],
		})) {
			events.push(event);
		}

		expect(calls[0]?.init.headers).toMatchObject({
			Accept: "text/event-stream",
			Authorization: "Bearer sk_live_test",
		});
		expect(events.map((event) => event.type)).toEqual([
			"text_delta",
			"text_delta",
			"usage",
			"done",
		]);
		const done = events.at(-1) as { result: { text: string }; priceMicro: number };
		expect(done.result.text).toBe("Hello.");
		expect(done.priceMicro).toBe(1000);
	});

	test("tool-call events pass through with their pieces", async () => {
		const { client } = scriptedClient(() =>
			sse([
				'event: tool_call_start\ndata: {"index":0,"id":"tc_1","name":"web_search"}',
				'event: tool_call_delta\ndata: {"index":0,"arguments":"{\\"query\\":\\"a\\""}',
				'event: tool_call_end\ndata: {"index":0}',
				'event: done\ndata: {"finishReason":"tool_calls","result":{"text":null,"toolCalls":[{"id":"tc_1","name":"web_search","arguments":{"query":"a"}}],"finishReason":"tool_calls","usage":{"inputTokens":5,"outputTokens":5}}}',
			]),
		);
		const events = [];
		for await (const event of client.llmChatStream({ messages: [] })) {
			events.push(event);
		}
		expect(events.map((event) => event.type)).toEqual([
			"tool_call_start",
			"tool_call_delta",
			"tool_call_end",
			"done",
		]);
	});

	test("a refused stream surfaces the error before any piece", async () => {
		const { client, calls } = scriptedClient(
			() =>
				new Response(
					JSON.stringify({
						error: { code: "unauthorized", message: "The key was refused." },
					}),
					{ status: 401 },
				),
		);
		try {
			await client.llmChatStream({ messages: [] }).next();
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(PramaanError);
			expect((error as PramaanError).status).toBe(401);
		}
		expect(calls[0]?.init.headers.Accept).toBe("text/event-stream");
	});

	test("a stream refused with 406 yields the plain reply as one done", async () => {
		const { client } = scriptedClient(
			() =>
				new Response(
					JSON.stringify({
						text: "Hello.",
						toolCalls: [],
						finishReason: "stop",
						usage: { inputTokens: 12, outputTokens: 3 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const events = [];
		for await (const event of client.llmChatStream({ messages: [] })) {
			events.push(event);
		}
		expect(events.length).toBe(1);
		expect(events[0]?.type).toBe("done");
	});

	test("a stream that ends early throws upstream_unavailable and yields no done", async () => {
		const { client } = scriptedClient(() =>
			sse(['event: text_delta\ndata: {"text":"Hel"}']),
		);
		const events = [];
		let error: PramaanError | null = null;
		try {
			for await (const event of client.llmChatStream({ messages: [] })) {
				events.push(event);
			}
			expect.unreachable();
		} catch (caught) {
			error = caught as PramaanError;
		}
		expect(events.map((event) => event.type)).toEqual(["text_delta"]);
		expect(error?.code).toBe("upstream_unavailable");
		expect(error?.retryable).toBe(true);
	});

	test("an error frame mid-stream throws the platform error", async () => {
		const { client } = scriptedClient(() =>
			sse([
				'event: text_delta\ndata: {"text":"Hel"}',
				'event: error\ndata: {"error":{"code":"invalid_request","message":"The JSON did not match."},"price_micro":5}',
			]),
		);
		const events = [];
		try {
			for await (const event of client.llmChatStream({ messages: [] })) {
				events.push(event);
			}
			expect.unreachable();
		} catch (error) {
			expect((error as PramaanError).code).toBe("invalid_request");
			expect((error as PramaanError).message).toBe("The JSON did not match.");
		}
	});
});
