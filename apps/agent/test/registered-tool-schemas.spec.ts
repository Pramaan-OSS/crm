import { expect, test } from "bun:test";
import {
	normalizedAuthoredSchema,
	registeredTools,
} from "../agent/lib/registered-tools";

const allowed = new Set([
	"type",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const",
	"anyOf",
	"$defs",
	"$ref",
	"title",
	"description",
	"default",
	"examples",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
]);
test("every registered tool schema fits the platform subset and limits", async () => {
	const paths = Array.from(
		new Bun.Glob("**/tools/*.ts").scanSync({
			cwd: new URL("../agent", import.meta.url).pathname,
		}),
	);
	expect(registeredTools.map((t) => t.name).sort()).toEqual(paths.sort());
	let enabled = 0;
	for (const tool of registeredTools) {
		if (tool.definition.kind === "eve:disabled-tool") continue;
		enabled++;
		const schema = normalizedAuthoredSchema(
			tool.definition.inputSchema,
			`Tool ${tool.name}`,
		);
		expect(Buffer.byteLength(JSON.stringify(schema))).toBeLessThanOrEqual(
			65536,
		);
		let nodes = 0;
		const check = (node: Record<string, unknown>, depth = 0) => {
			nodes++;
			expect(depth).toBeLessThanOrEqual(16);
			for (const key of Object.keys(node)) expect(allowed.has(key)).toBe(true);
			if (node.$ref) expect(String(node.$ref).startsWith("#/")).toBe(true);
			if (Array.isArray(node.enum))
				expect(node.enum.length).toBeLessThanOrEqual(256);
			if (Array.isArray(node.anyOf)) {
				expect(node.anyOf.length).toBeLessThanOrEqual(16);
				for (const child of node.anyOf) check(child, depth + 1);
			}
			for (const key of ["properties", "$defs"])
				if (node[key])
					for (const child of Object.values(node[key] as object))
						check(child, depth + 1);
			for (const key of ["items", "additionalProperties"])
				if (node[key] && typeof node[key] === "object")
					check(node[key] as Record<string, unknown>, depth + 1);
		};
		check(schema);
		expect(nodes).toBeLessThanOrEqual(256);
	}
	expect(enabled).toBeGreaterThan(0);
});

test("both registered output schemas fit the same bounded subset", async () => {
	const { assertBoundedJsonSchema } = await import("@crm/pramaan");
	for (const name of ["agent_builder", "agent_runner"]) {
		const definition = (await import(`../agent/subagents/${name}/agent.ts`))
			.default;
		const output = normalizedAuthoredSchema(
			definition.outputSchema,
			`Output ${name}`,
			"output",
		);
		expect(() =>
			assertBoundedJsonSchema(output, `Output ${name}`),
		).not.toThrow();
	}
});
