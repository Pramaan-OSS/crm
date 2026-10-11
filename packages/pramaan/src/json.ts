// Decoders for JSON that comes back from a capability. This is the one place loosely shaped
// output is narrowed; callers get typed values and never inspect raw shapes themselves.

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| JsonValue[]
	| JsonObject;

export interface JsonObject {
	[key: string]: JsonValue;
}

export function text(value: JsonValue): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function record(value: JsonValue): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value
		: undefined;
}

export function list(value: JsonValue): JsonValue[] {
	return Array.isArray(value) ? value : [];
}

/** The first non-blank string found under `keys`, in order. */
export function firstText(
	source: JsonValue,
	keys: readonly string[],
): string | undefined {
	const fields = record(source);
	if (!fields) return undefined;
	for (const key of keys) {
		const value = text(fields[key]);
		if (value?.trim()) return value;
	}
	return undefined;
}

/** `source` itself when it is a list, else the first list found under `keys`. */
export function firstList(
	source: JsonValue,
	keys: readonly string[],
): JsonValue[] {
	if (Array.isArray(source)) return source;
	const fields = record(source);
	for (const key of keys) {
		const value = fields?.[key];
		if (Array.isArray(value)) return value;
	}
	return [];
}
