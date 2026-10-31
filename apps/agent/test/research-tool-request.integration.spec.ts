import { expect, test } from "bun:test";
import { db } from "@crm/db";
import { FakePramaan } from "@crm/pramaan/fake";
import { createPramaanChatModel } from "../agent/lib/pramaan-chat-model";
import { companyPreamble } from "../agent/lib/preamble";
import { registeredTools } from "../agent/lib/registered-tools";
import { RESEARCH_INSTRUCTIONS } from "../agent/lib/research-instructions";

// Inspect installed runtime definitions without booting its scheduler or sandbox.
async function runtime(path: string) {
	return import(new URL(path, import.meta.resolve("eve")).href);
}
test("the first company step has no shell/file tools or todo and stays within request budgets", async () => {
	const { serializeInputSchema } = await runtime("./shared/tool-schema.js");
	const { SUBAGENT_TOOL_INPUT_SCHEMA } = await runtime(
		"./runtime/subagents/registry.js",
	);
	const tools = registeredTools
		.filter(
			(t) =>
				t.name.startsWith("tools/") &&
				t.definition.kind !== "eve:disabled-tool",
		)
		.map((t) => ({
			type: "function",
			name: t.name.slice(6, -3),
			description: (t.definition as { description: string }).description,
			inputSchema: serializeInputSchema(t.definition.inputSchema),
		}));
	for (const [file, exported] of [
		["ask-question", "ASK_QUESTION_TOOL_DEFINITION"],
		["skill", "SKILL_TOOL_DEFINITION"],
	]) {
		const definition = (await runtime(`./runtime/framework-tools/${file}.js`))[
			exported!
		];
		tools.push({
			type: "function",
			name: definition.name,
			description: definition.description,
			inputSchema: serializeInputSchema(definition.inputSchema),
		});
	}
	for (const name of ["agent_builder", "agent_runner"]) {
		const definition = (await import(`../agent/subagents/${name}/agent.ts`))
			.default;
		tools.push({
			type: "function",
			name,
			description: definition.description,
			inputSchema: serializeInputSchema(SUBAGENT_TOOL_INPUT_SCHEMA),
		});
	}
	expect(tools).toHaveLength(32);
	for (const name of [
		"bash",
		"glob",
		"grep",
		"read_file",
		"write_file",
		"todo",
	]) {
		expect(tools.some((t) => t.name === name)).toBe(false);
		expect(
			registeredTools.find((t) => t.name === `tools/${name}.ts`)?.definition
				.kind,
		).toBe("eve:disabled-tool");
	}
	for (const name of ["ask_question", "load_skill", "web_fetch"])
		expect(tools.some((t) => t.name === name)).toBe(true);
	const company = await db.company.create({
		data: { name: "Research request fixture", domain: "example.test" },
	});
	try {
		const preamble = await companyPreamble(company.id, {
			dispatched: true,
			kind: "company-profile",
			reason: "New company",
			budget: 4,
		});
		const base = await Bun.file(
			new URL("../agent/instructions.md", import.meta.url),
		).text();
		const fake = new FakePramaan();
		fake.routeStream(async function* () {
			yield {
				type: "done",
				result: {
					text: "Checked.",
					toolCalls: [],
					finishReason: "stop",
					usage: { inputTokens: 1, outputTokens: 1 },
				},
			};
		});
		const model = createPramaanChatModel({ pramaan: fake, tier: "best" });
		const result = await model.doStream({
			prompt: [
				{
					role: "system",
					content: `${base}\n\n${RESEARCH_INSTRUCTIONS}\n\n${preamble.markdown}`,
				},
				{
					role: "user",
					content: "Read the account and fill anything still missing.",
				},
			],
			tools,
		});
		for await (const _part of result.stream) {
		}
		const input = fake.streamCalls[0]?.input as {
			messages: unknown;
			tools: Array<{ parameters: unknown }>;
			maxTokens: number;
		};
		expect(input.tools).toHaveLength(32);
		expect(input.maxTokens).toBe(4096);
		const schemaBytes = input.tools.reduce(
			(total, tool) =>
				total + Buffer.byteLength(JSON.stringify(tool.parameters)),
			0,
		);
		expect(schemaBytes).toBeLessThanOrEqual(65536);
		console.info(
			`First-step fixture: ${input.tools.length} tools; ${schemaBytes} schema bytes; ${Buffer.byteLength(JSON.stringify(input))} request bytes; ${Math.ceil(Buffer.byteLength(JSON.stringify({ messages: input.messages, tools: input.tools })) / 4)} estimated input tokens.`,
		);
	} finally {
		await db.company.delete({ where: { id: company.id } });
	}
});
