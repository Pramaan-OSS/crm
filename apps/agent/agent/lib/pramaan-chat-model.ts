// The Pramaan chat model: one AI SDK language model whose every generation call is a
// `llm.chat` request through the Pramaan client. eve (the AI SDK) owns the tool loop —
// it sends the conversation and the tool list, this model translates one turn, and eve
// executes the tools and calls again with their results, exactly as the capability
// contract prescribes.
//
// Streaming (PRA-10): doStream consumes the platform's event stream so the CRM shows
// the text as it is written. A successful whole reply is accepted on the same
// request; any failed stream surfaces the error
// without re-running the call (what was generated may already be charged).

import {
	Cap,
	type Caps,
	type LlmChatStreamEvent,
	type Pramaan,
} from "@crm/pramaan";
import { z } from "zod";
import { normalizeJsonSchema } from "@crm/pramaan";

export interface PramaanChatModelOptions {
	/** The shared Pramaan client (a null install never constructs this model). */
	readonly pramaan: Pramaan;
	/** Platform quality tier. Default "balanced". */
	readonly tier?: "fast" | "balanced" | "best";
	/** Advertised context window, in tokens. */
	readonly contextWindowTokens?: number;
	/** Delay injection for local tests; production honours the server wait. */
	readonly waitForRateLimit?: WaitForModel;
}

import { requireCompleteReply, modelConfigurationError } from "./model-reply";
import { researchStepMaxTokens } from "./research-step";
import {
	withModelRateLimit,
	withStreamRateLimit,
	type WaitForModel,
} from "./model-rate-limit";
const LLM_CHAT_MAX_TOOLS = 64;
const LLM_CHAT_MAX_MESSAGES = 500;

const FINISH_REASONS = {
	stop: "stop",
	tool_calls: "tool-calls",
	length: "length",
	other: "other",
} as const;

type CallOptions = {
	readonly prompt: ReadonlyArray<unknown>;
	readonly tools?: ReadonlyArray<{
		readonly type: string;
		readonly name?: string;
		readonly description?: string;
		readonly inputSchema?: unknown;
	}>;
	readonly maxOutputTokens?: number;
	readonly temperature?: number;
	readonly responseFormat?: {
		readonly type: string;
		readonly schema?: unknown;
	};
};

const stringOrNull = z.string().trim().min(1).nullable().catch(null);
const stringList = z
	.array(z.string().min(1).nullable().catch(null))
	.transform((items) => items.filter((item) => item !== null))
	.catch([]);

function asString(value: unknown): string | null {
	return stringOrNull.parse(value);
}

function asList(value: unknown): string[] {
	return stringList.parse(value);
}

function parseArguments(input: unknown): Record<string, unknown> {
	if (input && typeof input === "object")
		return input as Record<string, unknown>;
	if (typeof input === "string") {
		try {
			const parsed = JSON.parse(input) as unknown;
			return parsed && typeof parsed === "object"
				? (parsed as Record<string, unknown>)
				: { value: parsed };
		} catch {
			return { value: input };
		}
	}
	return input === undefined || input === null ? {} : { value: input };
}

function textOfContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				part &&
				typeof part === "object" &&
				(part as { type?: string }).type === "text"
					? String((part as { text?: unknown }).text ?? "")
					: "",
			)
			.join("");
	}
	return "";
}

function toLlmChatMessages(
	prompt: ReadonlyArray<unknown>,
): Caps.LlmChatMessage[] {
	const messages: Caps.LlmChatMessage[] = [];
	for (const raw of prompt) {
		const message = raw as { role?: string; content?: unknown };
		switch (message.role) {
			case "system": {
				messages.push({
					role: "system",
					content: textOfContent(message.content),
				});
				break;
			}
			case "user": {
				messages.push({
					role: "user",
					content: textOfContent(message.content),
				});
				break;
			}
			case "assistant": {
				const parts = Array.isArray(message.content) ? message.content : [];
				const text = parts
					.filter((part) => (part as { type?: string }).type === "text")
					.map((part) => String((part as { text?: unknown }).text ?? ""))
					.join("");
				const toolCalls = parts
					.filter((part) => (part as { type?: string }).type === "tool-call")
					.map((part) => {
						const call = part as {
							toolCallId?: string;
							toolName?: string;
							input?: unknown;
						};
						return {
							id: String(call.toolCallId ?? ""),
							name: String(call.toolName ?? ""),
							arguments: parseArguments(call.input),
						};
					})
					.filter((call) => call.id !== "" && call.name !== "");
				messages.push({
					role: "assistant",
					...(text ? { content: text } : {}),
					...(toolCalls.length > 0 ? { toolCalls } : {}),
				});
				break;
			}
			case "tool": {
				const parts = Array.isArray(message.content) ? message.content : [];
				for (const rawPart of parts) {
					const part = rawPart as {
						type?: string;
						toolCallId?: string;
						output?: unknown;
					};
					if (part.type !== "tool-result") continue;
					const serialized = serializeToolOutput(part.output);
					messages.push({
						role: "tool",
						toolCallId: String(part.toolCallId ?? ""),
						content: serialized === "" ? "(empty result)" : serialized,
					});
				}
				break;
			}
		}
	}
	return messages.slice(0, LLM_CHAT_MAX_MESSAGES);
}

function serializeToolOutput(output: unknown): string {
	const parsed = toolOutputShape.parse(output);
	if (!parsed) return JSON.stringify(output ?? "");
	switch (parsed.type) {
		case "text":
		case "error-text":
			return parsed.value ?? "";
		case "json":
		case "error-json":
			return JSON.stringify(parsed.value ?? null);
		case "execution-denied":
			return JSON.stringify({ denied: true, reason: parsed.reason ?? null });
		default:
			return String(parsed);
	}
}

const toolOutputShape = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("text"),
			value: z.string().nullable().catch(null),
		}),
		z.object({
			type: z.literal("error-text"),
			value: z.string().nullable().catch(null),
		}),
		z.object({
			type: z.literal("json"),
			value: z.unknown().nullable().catch(null),
		}),
		z.object({
			type: z.literal("error-json"),
			value: z.unknown().nullable().catch(null),
		}),
		z.object({
			type: z.literal("execution-denied"),
			reason: z.unknown().nullable().catch(null),
		}),
	])
	.nullable()
	.catch(null);

function toLlmChatTools(callOptions: CallOptions): {
	tools: Caps.LlmChatTool[] | undefined;
	warnings: Array<{ type: "other"; message: string }>;
} {
	const functionTools = (callOptions.tools ?? []).filter(
		(
			tool,
		): tool is {
			type: "function";
			name: string;
			description?: string;
			inputSchema: Record<string, unknown>;
		} => tool.type === "function" && typeof tool.name === "string",
	);
	if (functionTools.length === 0) return { tools: undefined, warnings: [] };
	const warnings: Array<{ type: "other"; message: string }> = [];
	const selected = functionTools.slice(0, LLM_CHAT_MAX_TOOLS);
	if (functionTools.length > LLM_CHAT_MAX_TOOLS) {
		warnings.push({
			type: "other",
			message: `${functionTools.length - LLM_CHAT_MAX_TOOLS} tools dropped: the platform takes ${LLM_CHAT_MAX_TOOLS} per call.`,
		});
	}
	return {
		tools: selected.map((tool) => ({
			name: tool.name,
			...(tool.description
				? { description: tool.description.slice(0, 4096) }
				: {}),
			parameters: normalizeJsonSchema(tool.inputSchema, `Tool ${tool.name}`),
		})),
		warnings,
	};
}

/** One AI SDK language model backed entirely by the `llm.chat` capability. */
export function createPramaanChatModel(options: PramaanChatModelOptions) {
	const maxTokensPerStep = researchStepMaxTokens();
	const tier = options.tier ?? "balanced";
	const modelId = `pramaan-llm-chat-${tier}`;

	function toLlmChatWarnings(callOptions: CallOptions) {
		const functionTools = (callOptions.tools ?? []).filter(
			(tool) => tool.type === "function" && typeof tool.name === "string",
		);
		const warnings: Array<{ type: "other"; message: string }> = [];
		if (functionTools.length > LLM_CHAT_MAX_TOOLS) {
			warnings.push({
				type: "other",
				message: `${functionTools.length - LLM_CHAT_MAX_TOOLS} tools dropped: the platform takes ${LLM_CHAT_MAX_TOOLS} per call.`,
			});
		}
		return warnings;
	}

	function buildChatRequest(
		callOptions: CallOptions,
		warnings: Array<{ type: "other"; message: string }>,
	): Caps.LlmChatRequest {
		const { tools } = toLlmChatTools(callOptions);
		warnings.push(...toLlmChatWarnings(callOptions));
		return {
			messages: toLlmChatMessages(callOptions.prompt),
			...(tools ? { tools } : {}),
			model: tier,
			maxTokens: Math.max(
				64,
				Math.min(
					callOptions.maxOutputTokens ?? maxTokensPerStep,
					maxTokensPerStep,
				),
			),
			...(callOptions.temperature !== undefined
				? { temperature: callOptions.temperature }
				: {}),
			...(callOptions.responseFormat?.type === "json" &&
			callOptions.responseFormat.schema
				? {
						jsonSchema: normalizeJsonSchema(
							callOptions.responseFormat.schema,
							"Response",
						),
					}
				: {}),
		};
	}

	async function generate(callOptions: CallOptions): Promise<GenerateResult> {
		const warnings: Array<{ type: "other"; message: string }> = [];
		const request = buildChatRequest(callOptions, warnings);
		const result = await withModelRateLimit(
			() => options.pramaan.llmChat(request),
			options.waitForRateLimit,
		).catch((error) => {
			throw modelConfigurationError(error);
		});
		return { ...wholeReplyParts(result), warnings };
	}

	function doStream(callOptions: CallOptions) {
		const request = buildChatRequest(callOptions, []);

		return {
			stream: new ReadableStream({
				async start(controller) {
					let emitted = false;
					try {
						controller.enqueue({ type: "stream-start", warnings: [] });
						// True streaming (PRA-10): consume the platform's event stream.
						const toolCalls: Array<{
							id: string;
							name: string;
							arguments: string;
						}> = [];
						let usage = { input: 0, output: 0 };
						let textIndex = 0;
						let structuredText = "";

						for await (const event of withStreamRateLimit(
							() => options.pramaan.llmChatStream(request),
							options.waitForRateLimit,
						)) {
							switch (event.type) {
								case "text_delta": {
									if (request.jsonSchema) {
										structuredText += event.text;
										break;
									}
									const id = `text-${textIndex}`;
									controller.enqueue({ type: "text-start", id });
									controller.enqueue({
										type: "text-delta",
										id,
										delta: event.text,
									});
									controller.enqueue({ type: "text-end", id });
									textIndex += 1;
									emitted = true;
									break;
								}
								case "tool_call_start": {
									toolCalls.push({
										id: event.id,
										name: event.name,
										arguments: "",
									});
									emitted = true;
									break;
								}
								case "tool_call_delta": {
									const call = toolCalls.at(event.index);
									if (call) call.arguments += event.arguments;
									break;
								}
								case "tool_call_end": {
									// Tool input is released only after a complete final reply.
									break;
								}
								case "usage": {
									usage = {
										input: event.inputTokens,
										output: event.outputTokens,
									};
									break;
								}
								case "done": {
									const result = (event as { result?: Caps.LlmChatResult })
										.result;
									const finalReason =
										event.finishReason ?? result?.finishReason;
									requireCompleteReply(finalReason);
									if (
										request.jsonSchema &&
										structuredText &&
										(emitted || !result)
									) {
										controller.enqueue({ type: "text-start", id: "text-0" });
										controller.enqueue({
											type: "text-delta",
											id: "text-0",
											delta: structuredText,
										});
										controller.enqueue({ type: "text-end", id: "text-0" });
									}
									for (const call of toolCalls) {
										controller.enqueue({
											type: "tool-call",
											toolCallId: call.id,
											toolName: call.name,
											input: call.arguments || "{}",
										});
									}
									if (!emitted && result) {
										for (const part of wholeReplyParts(result).content) {
											if (part.type === "text") {
												controller.enqueue({
													type: "text-start",
													id: "text-0",
												});
												controller.enqueue({
													type: "text-delta",
													id: "text-0",
													delta: part.text,
												});
												controller.enqueue({ type: "text-end", id: "text-0" });
											} else controller.enqueue(part);
										}
										usage = {
											input: result.usage?.inputTokens ?? 0,
											output: result.usage?.outputTokens ?? 0,
										};
									}
									const finish =
										(event as { finishReason?: string }).finishReason ??
										result?.finishReason ??
										"other";
									controller.enqueue({
										type: "finish",
										finishReason: {
											unified:
												FINISH_REASONS[finish as keyof typeof FINISH_REASONS] ??
												"other",
											raw: finish,
										},
										usage: {
											inputTokens: {
												total: usage.input,
												noCache: usage.input,
												cacheRead: 0,
												cacheWrite: 0,
											},
											outputTokens: {
												total: usage.output,
												text: usage.output,
												reasoning: 0,
											},
										},
									});
									controller.close();
									return;
								}
							}
						}
						// Stream ended without `done`: dropped after pieces were sent.
						controller.enqueue({
							type: "finish",
							finishReason: {
								unified: emitted ? "error" : "other",
								raw: "stream_ended_early",
							},
							usage: {
								inputTokens: {
									total: usage.input,
									noCache: usage.input,
									cacheRead: 0,
									cacheWrite: 0,
								},
								outputTokens: {
									total: usage.output,
									text: usage.output,
									reasoning: 0,
								},
							},
						});
						controller.close();
					} catch (error) {
						// A failed stream may have spent money even before its first piece.
						controller.enqueue({
							type: "error",
							error: modelConfigurationError(error),
						});
						controller.enqueue({
							type: "finish",
							finishReason: {
								unified: "error",
								raw: (error as { code?: string }).code ?? null,
							},
							usage: {
								inputTokens: {
									total: 0,
									noCache: 0,
									cacheRead: 0,
									cacheWrite: 0,
								},
								outputTokens: { total: 0, text: 0, reasoning: 0 },
							},
						});
						controller.close();
					}
				},
			}),
		};
	}

	return {
		specificationVersion: "v3" as const,
		provider: "pramaan.chat",
		modelId,
		supportedUrls: {},
		doGenerate: generate,
		doStream,
	} as never;
}

type GenerateResult = {
	content: Array<
		| { type: "text"; text: string }
		| { type: "tool-call"; toolCallId: string; toolName: string; input: string }
	>;
	finishReason: {
		unified: "stop" | "tool-calls" | "length" | "error" | "other";
		raw: string | null;
	};
	usage: {
		inputTokens: {
			total: number;
			noCache: number;
			cacheRead: number;
			cacheWrite: number;
		};
		outputTokens: { total: number; text: number; reasoning: number };
	};
	warnings: Array<{ type: "other"; message: string }>;
};

function wholeReplyParts(
	result: Caps.LlmChatResult,
): Omit<GenerateResult, "warnings"> {
	requireCompleteReply(result.finishReason);
	const content: Array<
		| { type: "text"; text: string }
		| { type: "tool-call"; toolCallId: string; toolName: string; input: string }
	> = [];
	if (result.text !== undefined && result.text !== "") {
		content.push({ type: "text", text: result.text });
	}
	for (const call of result.toolCalls) {
		content.push({
			type: "tool-call",
			toolCallId: call.id,
			toolName: call.name,
			input: JSON.stringify(call.arguments ?? {}),
		});
	}
	return {
		content,
		finishReason: {
			unified: FINISH_REASONS[result.finishReason],
			raw: result.finishReason,
		},
		usage: {
			inputTokens: {
				total: result.usage.inputTokens,
				noCache: result.usage.inputTokens,
				cacheRead: 0,
				cacheWrite: 0,
			},
			outputTokens: {
				total: result.usage.outputTokens,
				text: result.usage.outputTokens,
				reasoning: 0,
			},
		},
	};
}
