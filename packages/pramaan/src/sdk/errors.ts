// One error type end to end: every Pramaan failure surfaces as a PramaanError with a stable code.
// Vendored from @pramaan/sdk and made standalone (no workspace imports).

export type ErrorCode =
	| "invalid_request"
	| "not_found"
	| "upstream_unavailable"
	| "upstream_timeout"
	| "internal"
	| "unauthorized"
	| "spend_cap_reached"
	| "rate_limited"
	| "conflict"
	| "connection_required"
	| "job_not_found";

const CODES: ReadonlySet<string> = new Set<ErrorCode>([
	"invalid_request",
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
	readonly retryable?: boolean;
	readonly requestId?: string | undefined;
	readonly status?: number | undefined;
	/** For `connection_required`: the capability family to connect (`email`, `apps`, ...). */
	readonly slot?: string | undefined;
}

export class PramaanError extends Error {
	readonly code: ErrorCode;
	readonly retryable: boolean;
	/** The API's `req_...` id. Undefined for local errors. */
	readonly requestId: string | undefined;
	/** HTTP status, when the error came from the API. */
	readonly status: number | undefined;
	readonly slot: string | undefined;

	constructor(
		code: ErrorCode,
		message: string,
		extras: PramaanErrorExtras = {},
	) {
		super(message);
		this.name = "PramaanError";
		this.code = code;
		this.retryable = extras.retryable ?? false;
		this.requestId = extras.requestId;
		this.status = extras.status;
		this.slot = extras.slot;
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
export async function errorFromResponse(
	response: Response,
): Promise<PramaanError> {
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
	return new PramaanError(code, message, {
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
