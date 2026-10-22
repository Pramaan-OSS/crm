// Shared schema boundary for generation requests. Original tool validators still
// validate execution inputs; removed format/pattern constraints remain described.
export type JsonSchema = Record<string, unknown>;
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
const types = new Set([
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null",
]);
const bounds = new Set([
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
]);
const record = (v: unknown): v is JsonSchema =>
	!!v &&
	typeof v === "object" &&
	!Array.isArray(v) &&
	[Object.prototype, null].includes(Object.getPrototypeOf(v));
const pathKey = (path: string, key: string) =>
	`${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
function fail(label: string, path: string, reason: string): never {
	throw new Error(`${label} schema at ${path}: ${reason}`);
}
function json(
	value: unknown,
	label: string,
	path: string,
	stack = new Set<object>(),
	depth = 0,
): void {
	if (depth > 32) fail(label, path, "JSON value is too deep");
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	)
		return;
	if (!(record(value) || Array.isArray(value)) || stack.has(value))
		fail(label, path, "must contain finite JSON values without cycles");
	stack.add(value);
	for (const [key, item] of Object.entries(value))
		json(item, label, pathKey(path, key), stack, depth + 1);
	stack.delete(value);
}
function children(node: JsonSchema, path: string): [unknown, string][] {
	const out: [unknown, string][] = [];
	for (const key of ["properties", "$defs"])
		if (record(node[key]))
			for (const [name, child] of Object.entries(node[key]))
				out.push([child, pathKey(pathKey(path, key), name)]);
	for (const key of ["items", "additionalProperties"])
		if (record(node[key])) out.push([node[key], pathKey(path, key)]);
	if (Array.isArray(node.anyOf))
		node.anyOf.forEach((child, i) => out.push([child, `${path}/anyOf/${i}`]));
	return out;
}
export function assertBoundedJsonSchema(
	value: unknown,
	label = "Response",
): asserts value is JsonSchema {
	if (!record(value)) fail(label, "#", "root must be a JSON Schema object");
	json(value, label, "#");
	if (Buffer.byteLength(JSON.stringify(value), "utf8") > 65536)
		fail(label, "#", "exceeds 64 KB");
	let count = 0;
	const nodes = new Set<JsonSchema>();
	const walk = (node: unknown, path: string, depth: number) => {
		if (!record(node)) fail(label, path, "must be a schema object");
		if (depth > 16) fail(label, path, "exceeds depth 16");
		if (++count > 256) fail(label, path, "exceeds 256 schema nodes");
		nodes.add(node);
		for (const [key, v] of Object.entries(node)) {
			const at = pathKey(path, key);
			if (!allowed.has(key)) fail(label, at, `unsupported keyword ${key}`);
			if (key === "type") {
				const ts = Array.isArray(v) ? v : [v];
				if (
					!ts.length ||
					new Set(ts).size !== ts.length ||
					ts.some((t) => typeof t !== "string" || !types.has(t))
				)
					fail(label, at, "invalid type");
			}
			if (["properties", "$defs", "items"].includes(key) && !record(v))
				fail(label, at, "must be an object");
			if (
				key === "required" &&
				(!Array.isArray(v) ||
					v.some((s) => typeof s !== "string") ||
					new Set(v).size !== v.length)
			)
				fail(label, at, "must be distinct property names");
			if (
				key === "additionalProperties" &&
				typeof v !== "boolean" &&
				!record(v)
			)
				fail(label, at, "must be boolean or a schema");
			if (key === "anyOf" && (!Array.isArray(v) || !v.length || v.length > 16))
				fail(label, at, "must have 1 to 16 branches");
			if (key === "enum" && (!Array.isArray(v) || !v.length || v.length > 256))
				fail(label, at, "must have 1 to 256 values");
			if (
				["title", "description", "$ref"].includes(key) &&
				typeof v !== "string"
			)
				fail(label, at, "must be a string");
			if (key === "examples" && !Array.isArray(v))
				fail(label, at, "must be an array");
			if (
				bounds.has(key) &&
				(typeof v !== "number" ||
					!Number.isFinite(v) ||
					(/(Length|Items)/.test(key) && (!Number.isInteger(v) || v < 0)))
			)
				fail(label, at, "invalid bound");
		}
		for (const [child, at] of children(node, path)) walk(child, at, depth + 1);
	};
	walk(value, "#", 0);
	let expanded = 0;
	const refs = (
		node: JsonSchema,
		path: string,
		stack: Set<JsonSchema>,
		depth: number,
	) => {
		if (stack.has(node) || depth > 32 || ++expanded > 4096)
			fail(label, path, "recursive or excessive reference expansion");
		const next = new Set(stack).add(node);
		if (typeof node.$ref === "string") {
			const at = `${path}/$ref`,
				ref = node.$ref;
			if (!ref.startsWith("#/") || /~(?![01])/.test(ref))
				fail(label, at, "only local #/... references are allowed");
			let target: unknown = value;
			for (const key of ref
				.slice(2)
				.split("/")
				.map((k) => k.replaceAll("~1", "/").replaceAll("~0", "~"))) {
				if (!record(target) || !Object.hasOwn(target, key))
					fail(label, at, "reference does not resolve");
				target = target[key];
			}
			if (!record(target) || !nodes.has(target))
				fail(label, at, "reference must resolve to a schema node");
			refs(target, at, next, depth + 1);
		}
		for (const [child, at] of children(node, path))
			refs(child as JsonSchema, at, next, depth + 1);
	};
	refs(value, "#", new Set(), 0);
}
function disjoint(a: JsonSchema, b: JsonSchema): boolean {
	const ta = Array.isArray(a.type) ? a.type : [a.type],
		tb = Array.isArray(b.type) ? b.type : [b.type];
	if (
		ta.every((t) => typeof t === "string") &&
		tb.every((t) => typeof t === "string") &&
		!ta.some(
			(t) =>
				tb.includes(t) ||
				(t === "integer" && tb.includes("number")) ||
				(t === "number" && tb.includes("integer")),
		)
	)
		return true;
	for (const key of Array.isArray(a.required) ? a.required : []) {
		if (
			typeof key !== "string" ||
			!Array.isArray(b.required) ||
			!b.required.includes(key) ||
			!record(a.properties) ||
			!record(b.properties)
		)
			continue;
		const pa = a.properties[key],
			pb = b.properties[key];
		if (
			record(pa) &&
			record(pb) &&
			Object.hasOwn(pa, "const") &&
			Object.hasOwn(pb, "const") &&
			JSON.stringify(pa.const) !== JSON.stringify(pb.const)
		)
			return true;
	}
	return false;
}
export function normalizeJsonSchema(
	value: unknown,
	label = "Response",
): JsonSchema {
	if (!record(value)) fail(label, "#", "root must be a JSON Schema object");
	json(value, label, "#");
	const convert = (input: unknown, path: string, depth: number): JsonSchema => {
		if (!record(input)) fail(label, path, "must be a schema object");
		if (depth > 16) fail(label, path, "exceeds depth 16");
		const out: JsonSchema = Object.create(null);
		const notes: string[] = [];
		for (const [originalKey, originalValue] of Object.entries(input)) {
			const key = originalKey === "definitions" ? "$defs" : originalKey;
			const v =
				key === "$ref" && typeof originalValue === "string"
					? originalValue.replace(/^#\/definitions\//, "#/$defs/")
					: originalValue;
			if (key === "$schema" || key === "format") continue;
			if (key === "pattern") {
				if (typeof v !== "string")
					fail(label, `${path}/pattern`, "must be a string");
				notes.push(`Value must match pattern: ${v}.`);
				continue;
			}
			if (key === "nullable" && v === false) continue;
			if (key === "nullable" && v === true) continue;
			if (
				key === "propertyNames" &&
				record(v) &&
				Object.keys(v).every((k) => k === "type") &&
				v.type === "string"
			)
				continue;
			if (key === "uniqueItems" && v === false) continue;
			if (key === "oneOf" || key === "allOf") continue;
			if (!allowed.has(key))
				fail(
					label,
					pathKey(path, key),
					`unsupported keyword ${key} cannot be expressed`,
				);
			if (key === "properties" || key === "$defs") {
				if (!record(v)) fail(label, pathKey(path, key), "must be an object");
				out[key] = Object.fromEntries(
					Object.entries(v).map(([name, child]) => [
						name,
						convert(child, pathKey(pathKey(path, key), name), depth + 1),
					]),
				);
			} else if (
				key === "items" ||
				(key === "additionalProperties" && record(v))
			)
				out[key] = convert(v, pathKey(path, key), depth + 1);
			else if (key === "anyOf") {
				if (!Array.isArray(v) || !v.length || v.length > 16)
					fail(label, `${path}/anyOf`, "must have 1 to 16 branches");
				out.anyOf = v.map((child, i) =>
					convert(child, `${path}/anyOf/${i}`, depth + 1),
				);
			} else out[key] = v;
		}
		if (notes.length)
			out.description = [out.description, ...notes].filter(Boolean).join(" ");
		if (input.allOf !== undefined) {
			if (!Array.isArray(input.allOf) || input.allOf.length !== 1)
				fail(label, `${path}/allOf`, "intersection cannot be expressed safely");
			const child = convert(input.allOf[0], `${path}/allOf/0`, depth + 1);
			for (const [key, v] of Object.entries(child)) {
				if (
					Object.hasOwn(out, key) &&
					JSON.stringify(out[key]) !== JSON.stringify(v)
				)
					fail(label, `${path}/allOf`, "conflicting intersection");
				out[key] = v;
			}
		}
		if (input.oneOf !== undefined) {
			if (
				!Array.isArray(input.oneOf) ||
				!input.oneOf.length ||
				input.oneOf.length > 16 ||
				out.anyOf
			)
				fail(
					label,
					`${path}/oneOf`,
					"exclusive union cannot be expressed safely",
				);
			const branches = input.oneOf.map((child, i) =>
				convert(child, `${path}/oneOf/${i}`, depth + 1),
			);
			if (
				branches.some((a, i) =>
					branches.slice(i + 1).some((b) => !disjoint(a, b)),
				)
			)
				fail(
					label,
					`${path}/oneOf`,
					"overlapping exclusive union cannot be expressed safely",
				);
			out.anyOf = branches;
		}
		if (input.nullable === true) return { anyOf: [out, { type: "null" }] };
		if (input.nullable !== undefined && typeof input.nullable !== "boolean")
			fail(label, `${path}/nullable`, "must be boolean");
		return out;
	};
	const result = convert(value, "#", 0);
	assertBoundedJsonSchema(result, label);
	return result;
}
export function validateGenerationSchemas(input: unknown): void {
	if (!record(input)) return;
	if (Array.isArray(input.tools)) {
		if (input.tools.length > 64)
			fail("Generation", "#/tools", "exceeds 64 tools");
		const bytes = input.tools.reduce(
			(sum, tool) =>
				sum +
				(record(tool) ? Buffer.byteLength(JSON.stringify(tool.parameters)) : 0),
			0,
		);
		if (bytes > 65536)
			fail("Generation", "#/tools", "combined tool schemas exceed 64 KiB");
		for (const tool of input.tools)
			if (record(tool))
				assertBoundedJsonSchema(tool.parameters, `Tool ${String(tool.name)}`);
	}
	if (input.jsonSchema !== undefined)
		assertBoundedJsonSchema(input.jsonSchema, "Response");
}
export function normalizeGenerationSchemas<T>(input: T): T {
	if (!record(input)) return input;
	const result = {
		...input,
		...(Array.isArray(input.tools)
			? {
					tools: input.tools.map((tool) =>
						record(tool)
							? {
									...tool,
									parameters: normalizeJsonSchema(
										tool.parameters,
										`Tool ${String(tool.name)}`,
									),
								}
							: tool,
					),
				}
			: {}),
		...(input.jsonSchema !== undefined
			? { jsonSchema: normalizeJsonSchema(input.jsonSchema, "Response") }
			: {}),
	} as T;
	validateGenerationSchemas(result);
	return result;
}
