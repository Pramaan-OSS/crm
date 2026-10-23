import { describe, expect, test } from "bun:test";

import { FakePramaan } from "@crm/pramaan/fake";

import { createPramaanChatModel } from "../agent/lib/pramaan-chat-model";

// A tool-result output as the AI SDK hands it to a provider.
type Prompt = ReadonlyArray<unknown>;

const promptWithToolResult: Prompt = [
	{ role: "system", content: "You are the research agent." },
	{ role: "user", content: [{ type: "text", text: "Research Acme." }] },
	{
		role: "assistant",
		content: [
			{ type: "text", text: "Looking them up." },
			{
				type: "tool-call",
				toolCallId: "tc_search_1",
				toolName: "web_search",
				input: { query: "Acme" },
			},
		],
	},
	{
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: "tc_search_1",
				toolName: "web_search",
				output: { type: "json", value: { results: ["acme.com"] } },
			},
		],
	},
];

const tools = [
	{
		type: "function",
		name: "web_search",
		description: "Search the web",
		inputSchema: { type: "object", properties: { query: { type: "string" } } },
	},
];

describe("createPramaanChatModel", () => {
	test("one generation call maps to one llm.chat call with the conversation and tools", async () => {
		const fake = new FakePramaan({
			"llm.chat": () => ({
				text: "Acme is a company.",
				toolCalls: [],
				finishReason: "stop",
				usage: { inputTokens: 12, outputTokens: 5 },
			}),
		});
		const model = createPramaanChatModel({ pramaan: fake, tier: "best" });

		const result = await model.doGenerate({
			prompt: promptWithToolResult,
			tools,
			maxOutputTokens: 2048,
		});

		expect(fake.calls.length).toBe(1);
		expect(fake.calls[0]?.id).toBe("llm.chat");
		type ChatRequest = {
			model: string;
			maxTokens: number;
			messages: Array<Record<string, string | object>>;
			tools: Array<Record<string, string | object>>;
		};
		const input = fake.calls[0]?.input as ChatRequest;
		expect(input["model"]).toBe("best");
		expect(input["maxTokens"]).toBe(1024);

		// A session budget larger than the step ceiling must not raise the
		// reservation: the platform prices the worst case from this field.
		const big = await model.doGenerate({
			prompt: promptWithToolResult,
			tools,
			maxOutputTokens: 100_000,
		});
		void big;
		const bigInput = fake.calls[fake.calls.length - 1]?.input as ChatRequest;
		expect(bigInput["maxTokens"]).toBe(1024);
		const messages = input["messages"];
		expect(messages).toEqual([
			{ role: "system", content: "You are the research agent." },
			{ role: "user", content: "Research Acme." },
			{
				role: "assistant",
				content: "Looking them up.",
				toolCalls: [
					{
						id: "tc_search_1",
						name: "web_search",
						arguments: { query: "Acme" },
					},
				],
			},
			{
				role: "tool",
				toolCallId: "tc_search_1",
				content: '{"results":["acme.com"]}',
			},
		]);
		expect(input["tools"]).toEqual([
			{
				name: "web_search",
				description: "Search the web",
				parameters: {
					type: "object",
					properties: { query: { type: "string" } },
				},
			},
		]);

		expect(result.content).toEqual([
			{ type: "text", text: "Acme is a company." },
		]);
		expect(result.finishReason).toEqual({ unified: "stop", raw: "stop" });
		expect(result.usage.inputTokens.total).toBe(12);
		expect(result.usage.outputTokens.total).toBe(5);
		expect(result.warnings).toEqual([]);
	});

	test("tool calls come back as AI SDK tool-call parts and the finish reason maps", async () => {
		const fake = new FakePramaan({
			"llm.chat": () => ({
				text: undefined,
				toolCalls: [
					{
						id: "tc_web_search_1",
						name: "web_search",
						arguments: { query: "Acme Corp" },
					},
				],
				finishReason: "tool_calls",
				usage: { inputTokens: 30, outputTokens: 9 },
			}),
		});
		const model = createPramaanChatModel({ pramaan: fake });

		const result = await model.doGenerate({
			prompt: promptWithToolResult,
			tools,
		});

		expect(result.content).toEqual([
			{
				type: "tool-call",
				toolCallId: "tc_web_search_1",
				toolName: "web_search",
				input: '{"query":"Acme Corp"}',
			},
		]);
		expect(result.finishReason.unified).toBe("tool-calls");
		expect(result.finishReason.raw).toBe("tool_calls");
	});

	test("doStream streams real deltas from the platform and finishes once", async () => {
		const fake = new FakePramaan();
		fake.routeStream(async function* () {
			yield { type: "text_delta", text: "Hel" };
			yield { type: "text_delta", text: "lo." };
			yield { type: "usage", inputTokens: 3, outputTokens: 2 };
			yield {
				type: "done",
				result: {
					text: "Hello.",
					toolCalls: [],
					finishReason: "stop",
					usage: { inputTokens: 3, outputTokens: 2 },
				},
				finishReason: "stop",
			};
		});
		const model = createPramaanChatModel({ pramaan: fake });

		const { stream } = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
		});
		const parts = await Array.fromAsync(stream);

		expect(parts[0]).toEqual({ type: "stream-start", warnings: [] });
		expect(parts.at(-1)?.type).toBe("finish");
		const deltas = parts.filter((part) => part.type === "text-delta");
		expect(deltas).toEqual([
			{ type: "text-delta", id: "text-0", delta: "Hel" },
			{ type: "text-delta", id: "text-1", delta: "lo." },
		]);
		expect(parts.filter((part) => part.type === "text-start").length).toBe(2);
		expect(parts.filter((part) => part.type === "text-end").length).toBe(2);
	});

	test("an unavailable stream before its first piece never resends the model call", async () => {
		const fake = new FakePramaan();
		fake.routeStream(async function* () {
			yield* [];
			const error = new Error("Model service unavailable");
			(error as { code?: string }).code = "upstream_unavailable";
			throw error;
		});
		const { stream } = await createPramaanChatModel({ pramaan: fake }).doStream(
			{ prompt: [{ role: "user", content: "Research." }] },
		);
		const parts = await Array.fromAsync(stream);
		expect(parts.some((part) => part.type === "error")).toBe(true);
		expect(parts.at(-1)).toMatchObject({
			type: "finish",
			finishReason: { unified: "error" },
		});
		expect(fake.streamCalls).toHaveLength(1);
		expect(fake.callsTo("llm.chat")).toHaveLength(0);
	});
	test("a whole reply received on the original stream request needs no second call", async () => {
		const fake = new FakePramaan();
		fake.routeStream(async function* () {
			yield {
				type: "done",
				result: {
					text: "Found.",
					toolCalls: [
						{
							id: "call-fixture",
							name: "read_company_history",
							arguments: { companyId: "fixture" },
						},
					],
					finishReason: "tool_calls",
					usage: { inputTokens: 1, outputTokens: 1 },
				},
			};
		});
		const { stream } = await createPramaanChatModel({ pramaan: fake }).doStream(
			{ prompt: [{ role: "user", content: "Research." }] },
		);
		const parts = await Array.fromAsync(stream);
		expect(parts.some((part) => part.type === "text-delta")).toBe(true);
		expect(parts.some((part) => part.type === "tool-call")).toBe(true);
		expect(parts.at(-1)).toMatchObject({
			type: "finish",
			finishReason: { unified: "tool-calls" },
		});
		expect(fake.streamCalls).toHaveLength(1);
		expect(fake.callsTo("llm.chat")).toHaveLength(0);
	});

	test("a stream that drops mid-way surfaces the error without re-running the call", async () => {
		let chatCalls = 0;
		const fake = new FakePramaan();
		fake.routeStream(async function* () {
			yield { type: "text_delta", text: "Hel" };
			const error = new Error(
				"The connection closed before the reply was complete.",
			);
			(error as { code?: string }).code = "upstream_unavailable";
			throw error;
		});
		fake.route({
			"llm.chat": () => {
				chatCalls += 1;
				return {
					text: "should not be called",
					toolCalls: [],
					finishReason: "stop",
					usage: {},
				};
			},
		});
		const model = createPramaanChatModel({ pramaan: fake });

		const { stream } = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
		});
		const parts = await Array.fromAsync(stream);

		expect(parts.at(-1)?.type).toBe("finish");
		expect(
			(parts.at(-1) as { finishReason?: { unified?: string } }).finishReason
				?.unified,
		).toBe("error");
		expect(chatCalls).toBe(0);
	});

	test("an empty tool result is sent as a non-empty placeholder, as the contract requires", async () => {
		const fake = new FakePramaan({
			"llm.chat": () => ({
				text: "done",
				toolCalls: [],
				finishReason: "stop",
				usage: { inputTokens: 1, outputTokens: 1 },
			}),
		});
		const model = createPramaanChatModel({ pramaan: fake });

		await model.doGenerate({
			prompt: [
				...promptWithToolResult.slice(0, 3),
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "tc_search_1",
							toolName: "web_search",
							output: { type: "text", value: "" },
						},
					],
				},
			],
		});

		const input = fake.calls[0]?.input as ChatRequest;
		const toolMessage = input.messages.at(-1) as { content: string };
		expect(toolMessage.content).toBe("(empty result)");
	});
});

test("tool and response schemas are normalized before the strict fake accepts a model turn", async () => {
	const fake = new FakePramaan({
		"llm.chat": () => ({
			text: "ok",
			toolCalls: [],
			finishReason: "stop",
			usage: { inputTokens: 1, outputTokens: 1 },
		}),
	});
	const model = createPramaanChatModel({ pramaan: fake });
	await model.doGenerate({
		prompt: [{ role: "user", content: "Hello" }],
		tools: [
			{
				type: "function",
				name: "lookup",
				inputSchema: {
					type: "object",
					$schema: "draft",
					properties: {
						email: { type: "string", format: "email", pattern: "@" },
					},
				},
			},
		],
		responseFormat: {
			type: "json",
			schema: {
				type: "object",
				$schema: "draft",
				properties: { answer: { type: "string", format: "text" } },
			},
		},
	});
	const request = fake.calls[0]?.input as {
		tools: { parameters: Record<string, unknown> }[];
		jsonSchema: Record<string, unknown>;
	};
	expect(request.tools[0]?.parameters.$schema).toBeUndefined();
	expect(request.jsonSchema.$schema).toBeUndefined();
	expect(fake.callsTo("llm.chat")).toHaveLength(1);
});
