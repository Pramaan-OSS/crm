// One error type end to end: every Pramaan failure surfaces as a PramaanError with a stable code.
// Preserve retry timing and accepted job identity, absent from the package error extras.

import type { ErrorCode } from "@pramaan/sdk";
import { PramaanError as SdkPramaanError } from "@pramaan/sdk";

export type { ErrorCode } from "@pramaan/sdk";

const CODES: ReadonlySet<string> = new Set<ErrorCode>([
	"invalid_request",
	"forbidden",
	"not_found",
	"upstream_unavailable",
	"upstream_timeout",
	"internal",
	"unauthorized",
	"spend_cap_reached",
	"rate_limited",
	"conflict",
	"connection_required",
	"job_not_found",
]);

export interface PramaanErrorExtras {
	readonly reason?: string;
	readonly plan?: unknown;
	readonly needs?: unknown;
	readonly retryable?: boolean;
	/** Server Retry-After, converted to milliseconds. */
	readonly retryAfterMs?: number;
	readonly jobId?: string;
	readonly requestId?: string | undefined;
	readonly status?: number | undefined;
	/** For `connection_required`: the capability family to connect (`email`, `apps`, ...). */
	readonly slot?: string | undefined;
}

export class PramaanError extends SdkPramaanError {
	static override [Symbol.hasInstance](value: unknown): boolean {
		// biome-ignore lint/complexity/noThisInStatic: Preserve native checks for subclasses.
		if (this === PramaanError) return value instanceof SdkPramaanError;
		// biome-ignore lint/complexity/noThisInStatic: The subclass constructor is required here.
		return Function.prototype[Symbol.hasInstance].call(this, value);
	}

	override readonly reason: string | undefined;
	readonly plan: unknown;
	readonly needs: unknown;
	readonly jobId: string | undefined;
	readonly retryAfterMs: number | undefined;
	/** The API's `req_...` id. Undefined for local errors. */
	/** HTTP status, when the error came from the API. */

	constructor(
		code: ErrorCode,
		message: string,
		extras: PramaanErrorExtras = {},
	) {
		super(code, message, extras);
		this.name = "PramaanError";
		// The published constructor truncates at 200 characters, dropping server diagnostics.
		this.message = message;
		this.reason = extras.reason;
		this.plan = extras.plan;
		this.needs = extras.needs;
		this.jobId = extras.jobId;
		this.retryAfterMs = extras.retryAfterMs;
	}
}

function codeForStatus(status: number): ErrorCode {
	if (status === 400) return "invalid_request";
	if (status === 401 || status === 403) return "unauthorized";
	if (status === 402) return "spend_cap_reached";
	if (status === 404) return "not_found";
	if (status === 409) return "conflict";
	if (status === 429) return "rate_limited";
	if (status === 504) return "upstream_timeout";
	if (status >= 500) return "upstream_unavailable";
	return "internal";
}

/** Builds a PramaanError from a non-2xx response: the API's envelope, or a status-based fallback. */
export async function errorFromResponse(response: {
	readonly headers: { get(name: string): string | null };
	readonly status: number;
	json(): Promise<unknown>;
}): Promise<PramaanError> {
	const headerId = response.headers.get("x-request-id") ?? undefined;
	let envelope: Record<string, unknown> | undefined;
	try {
		const body = (await response.json()) as { error?: unknown };
		if (body && typeof body.error === "object" && body.error !== null) {
			envelope = body.error as Record<string, unknown>;
		}
	} catch {
		// Not JSON (a proxy page, an empty body): fall back to the status.
	}
	const code =
		typeof envelope?.code === "string" && CODES.has(envelope.code)
			? (envelope.code as ErrorCode)
			: codeForStatus(response.status);
	const message =
		typeof envelope?.message === "string"
			? envelope.message
			: `The API answered with HTTP ${response.status}.`;

	const wait = response.headers.get("retry-after");
	let retryAfterMs: number | undefined;
	if (wait !== null && wait.trim() !== "") {
		const seconds = Number(wait);
		const parsed = Number.isFinite(seconds)
			? seconds * 1000
			: Date.parse(wait) - Date.now();
		if (Number.isFinite(parsed) && parsed >= 0) retryAfterMs = parsed;
	}
	return new PramaanError(code, message, {
		retryAfterMs,
		reason: typeof envelope?.reason === "string" ? envelope.reason : undefined,
		plan: envelope?.plan,
		needs: envelope?.needs,
		retryable:
			typeof envelope?.retryable === "boolean"
				? envelope.retryable
				: response.status === 429 || response.status >= 500,
		requestId:
			typeof envelope?.request_id === "string" ? envelope.request_id : headerId,
		status: response.status,
		slot: typeof envelope?.slot === "string" ? envelope.slot : undefined,
	});
}
