import { expect, test } from "bun:test";
import {
	assertBoundedJsonSchema,
	normalizeJsonSchema,
	Pramaan,
	PramaanClient,
} from "../src";
import { FakePramaan } from "../src/fake";

test("normalization preserves schema maps and literals while removing annotations", () => {
	const input = {
		type: "object",
		$schema: "draft",
		properties: {
			email: { type: "string", format: "email", pattern: "@", default: "a@b" },
			format: { enum: ["format", "pattern"] },
		},
		required: ["email"],
		additionalProperties: false,
	};
	const normalized = normalizeJsonSchema(input, "Tool lookup");
	expect(normalized).toEqual({
		type: "object",
		properties: {
			email: {
				type: "string",
				default: "a@b",
				description: "Value must match pattern: @.",
			},
			format: { enum: ["format", "pattern"] },
		},
		required: ["email"],
		additionalProperties: false,
	});
	expect(input.properties.email.format).toBe("email");
});
test("disjoint exclusive branches translate; overlapping branches fail with the tool and path", () => {
	expect(
		normalizeJsonSchema({
			type: "object",
			properties: {
				value: { oneOf: [{ type: "string" }, { type: "integer" }] },
			},
		}),
	).toEqual({
		type: "object",
		properties: { value: { anyOf: [{ type: "string" }, { type: "integer" }] } },
	});
	expect(() =>
		normalizeJsonSchema(
			{
				type: "object",
				properties: {
					value: { oneOf: [{ type: "number" }, { type: "integer" }] },
				},
			},
			"Tool search",
		),
	).toThrow("Tool search schema at #/properties/value/oneOf");
});
test("local definitions and references translate without changing targets", () => {
	const schema = normalizeJsonSchema({
		type: "object",
		definitions: { value: { type: "string" } },
		properties: { x: { $ref: "#/definitions/value" } },
	});
	expect(schema.$defs).toEqual({ value: { type: "string" } });
	expect((schema.properties as Record<string, unknown>).x).toEqual({
		$ref: "#/$defs/value",
	});
});
for (const [name, schema, path] of [
	["nonobject", [], "#"],
	[
		"external ref",
		{
			type: "object",
			properties: { x: { $ref: "https://example.test/schema" } },
		},
		"#/properties/x/$ref",
	],
	[
		"dangling ref",
		{ type: "object", properties: { x: { $ref: "#/$defs/nope" } } },
		"#/properties/x/$ref",
	],
	[
		"recursive ref",
		{ type: "object", $defs: { x: { $ref: "#/$defs/x" } } },
		"#/$defs/x",
	],
	[
		"unknown keyword",
		{ type: "object", properties: { x: { not: { type: "null" } } } },
		"#/properties/x/not",
	],
	[
		"intersection",
		{ type: "object", allOf: [{ type: "object" }, { type: "object" }] },
		"#/allOf",
	],
	[
		"anyOf limit",
		{
			type: "object",
			properties: {
				x: { anyOf: Array.from({ length: 17 }, () => ({ type: "string" })) },
			},
		},
		"#/properties/x/anyOf",
	],
	[
		"enum limit",
		{
			type: "object",
			properties: { x: { enum: Array.from({ length: 257 }, (_, i) => i) } },
		},
		"#/properties/x/enum",
	],
	["size limit", { type: "object", description: "a".repeat(65536) }, "#"],
] as const)
	test(`reject ${name} locally with a named path`, () => {
		expect(() => normalizeJsonSchema(schema, "Tool named")).toThrow(
			`Tool named schema at ${path}`,
		);
	});
test("schema-node and depth boundaries match the platform", () => {
	const nodes = (count: number) => ({
		type: "object",
		properties: Object.fromEntries(
			Array.from({ length: count }, (_, i) => [String(i), { type: "string" }]),
		),
	});
	expect(() => assertBoundedJsonSchema(nodes(255))).not.toThrow();
	expect(() => assertBoundedJsonSchema(nodes(256), "Tool nodes")).toThrow(
		"256 schema nodes",
	);
	const depth = (count: number): Record<string, unknown> =>
		count ? { type: "array", items: depth(count - 1) } : { type: "string" };
	expect(() => assertBoundedJsonSchema(depth(16))).not.toThrow();
	expect(() => assertBoundedJsonSchema(depth(17), "Tool deep")).toThrow(
		"depth 16",
	);
});
test("fake rejects raw unsupported tools and response schemas before invoking routes", async () => {
	let calls = 0;
	const fake = new FakePramaan({
		"llm.chat": () => {
			calls++;
		},
		"llm.complete": () => {
			calls++;
		},
	});
	await expect(
		fake.llmChat({
			messages: [],
			tools: [
				{
					name: "lookup",
					parameters: {
						type: "object",
						properties: { x: { format: "email" } },
					},
				},
			],
		}),
	).rejects.toThrow("Tool lookup schema at #/properties/x/format");
	await expect(
		fake.llmComplete({
			prompt: "x",
			jsonSchema: { type: "object", $schema: "draft" },
		}),
	).rejects.toThrow("Response schema at #/$schema");
	fake.routeStream(async function* () {
		calls++;
	});
	await expect(
		(async () => {
			for await (const _ of fake.llmChatStream({
				messages: [],
				jsonSchema: { type: "object", format: "x" },
			})) {
			}
		})(),
	).rejects.toThrow("Response schema at #/format");
	expect(calls).toBe(0);
});
test("the real client boundary normalizes both chat and completion requests with scripted fetch", async () => {
	const bodies: Record<string, unknown>[] = [];
	const api = new Pramaan(
		new PramaanClient({
			apiKey: "fake",
			fetch: async (_url, init) => {
				bodies.push(JSON.parse(String(init.body)));
				return Response.json({
					result: {
						text: "ok",
						toolCalls: [],
						finishReason: "stop",
						usage: { inputTokens: 1, outputTokens: 1 },
					},
				});
			},
		}),
	);
	await api.llmComplete({
		prompt: "x",
		jsonSchema: {
			type: "object",
			$schema: "draft",
			properties: { x: { type: "string", format: "email" } },
		},
	});
	await api.llmChat({
		messages: [],
		tools: [
			{ name: "lookup", parameters: { type: "object", $schema: "draft" } },
		],
	});
	for (const body of bodies) {
		if (body.jsonSchema) assertBoundedJsonSchema(body.jsonSchema);
		if (body.tools)
			for (const tool of body.tools as { parameters: unknown }[])
				assertBoundedJsonSchema(tool.parameters);
	}
	expect(bodies).toHaveLength(2);
});

test("combined tool schemas have a 64 KiB budget and at most 64 entries", async () => {
	const { validateGenerationSchemas, normalizeGenerationSchemas } =
		await import("../src/json-schema");
	const tool = {
		name: "lookup",
		parameters: { type: "object", description: "x".repeat(34000) },
	};
	for (const check of [validateGenerationSchemas, normalizeGenerationSchemas]) {
		expect(() => check({ tools: [tool, tool] })).toThrow(
			"combined tool schemas",
		);
		expect(() =>
			check({
				tools: Array.from({ length: 65 }, () => ({
					name: "lookup",
					parameters: { type: "object" },
				})),
			}),
		).toThrow("64 tools");
	}
});
