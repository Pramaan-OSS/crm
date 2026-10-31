import { expect, test } from "bun:test";
import { PramaanError } from "@crm/pramaan";
import { FakePramaan } from "@crm/pramaan/fake";
import { createPramaanChatModel } from "../agent/lib/pramaan-chat-model";

const options = {
	prompt: [{ role: "user", content: "Research this company." }],
};
const partial = {
	text: '{"name":',
	toolCalls: [],
	finishReason: "length",
	usage: { inputTokens: 3, outputTokens: 256 },
};
test("whole research replies fail on length before text or tool inputs are returned", async () => {
	const fake = new FakePramaan({ "llm.chat": () => partial });
	const model = createPramaanChatModel({ pramaan: fake });
	for (const format of [
		undefined,
		{ type: "json", schema: { type: "object", properties: {} } },
	]) {
		await expect(
			model.doGenerate({ ...options, responseFormat: format }),
		).rejects.toThrow("incomplete");
	}
	expect(fake.calls).toHaveLength(2);
});
test("streamed length fails without releasing tool calls or structured text", async () => {
	for (const structured of [false, true]) {
		const fake = new FakePramaan();
		fake.routeStream(async function* () {
			yield* [];
			yield { type: "text_delta", text: '{"name":' };
			yield {
				type: "tool_call_start",
				index: 0,
				id: "call-1",
				name: "save_company",
			};
			yield { type: "tool_call_delta", index: 0, arguments: '{"name":' };
			yield { type: "tool_call_end", index: 0 };
			yield { type: "done", finishReason: "length" };
		});
		const model = createPramaanChatModel({ pramaan: fake });
		const result = await model.doStream({
			...options,
			...(structured
				? {
						responseFormat: {
							type: "json",
							schema: { type: "object", properties: {} },
						},
					}
				: {}),
		});
		const parts = [];
		for await (const part of result.stream) parts.push(part);
		expect(parts.some((p) => p.type === "tool-call")).toBe(false);
		if (structured)
			expect(parts.some((p) => p.type === "text-delta")).toBe(false);
		expect(parts.find((p) => p.type === "error")?.error.message).toContain(
			"incomplete",
		);
		expect(parts.at(-1).finishReason.unified).toBe("error");
		expect(fake.streamCalls).toHaveLength(1);
	}
});
test("maxTokens refusal is a configuration error with no retry on either path", async () => {
	const error = new PramaanError(
		"invalid_request",
		"maxTokens reached without output",
		{
			status: 400,
			requestId: "req_reply_limit",
			reason: "maxTokens must allow a complete answer",
		},
	);
	const fake = new FakePramaan({
		"llm.chat": () => {
			throw error;
		},
	});
	fake.routeStream(async function* () {
		yield* [];
		throw error;
	});
	const model = createPramaanChatModel({ pramaan: fake });
	await expect(model.doGenerate(options)).rejects.toThrow("administrator");
	await expect(model.doGenerate(options)).rejects.toThrow("req_reply_limit");
	await expect(model.doGenerate(options)).rejects.toThrow(
		"maxTokens must allow a complete answer",
	);
	const { stream } = await model.doStream(options);
	const parts = [];
	for await (const part of stream) parts.push(part);
	expect(parts.find((p) => p.type === "error")?.error.message).toContain(
		"administrator",
	);
	expect(parts.find((p) => p.type === "error")?.error.message).toContain(
		"req_reply_limit",
	);
	expect(parts.find((p) => p.type === "error")?.error.message).toContain(
		"maxTokens must allow a complete answer",
	);
	expect(fake.calls).toHaveLength(3);
	expect(fake.streamCalls).toHaveLength(1);
});
