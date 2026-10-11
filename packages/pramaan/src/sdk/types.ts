// Shared types for the Pramaan client. Vendored from @pramaan/sdk and made standalone.

import type { ErrorCode } from "./errors";

export type EffectClass =
	| "read_only"
	| "external_reversible"
	| "external_irreversible"
	| "external_unknown_effect";

export type { ErrorCode };

/** Traits of one capability; the client reads them to decide retries. */
export interface CapabilityInfo {
	readonly id: string;
	readonly description: string;
	readonly effectClass: EffectClass;
	readonly mode: "sync" | "async";
	readonly needsConnection: boolean;
	readonly requiresApproval?: boolean;
}

export interface RunOptions {
	/**
	 * Required for `external_*` capabilities (a retry with the same key never sends twice).
	 * Optional otherwise: the same key returns the stored result without a new charge.
	 */
	readonly idempotencyKey?: string;
	/** The most this call may be priced at, in micro-USD (a whole number above 0). */
	readonly maxPriceMicro?: number;
	/** Ask one more source when the first answer is weak. You pay for each source that answered. */
	readonly secondOpinion?: boolean;
}

/** What a request would cost at most, from `capabilities.estimate`. Nothing was run. */
export interface Estimate {
	readonly priceMaxMicro: number;
	readonly balanceMicro: number;
	readonly canRun: boolean;
	readonly reason?: "balance" | "daily_cap" | "price_ceiling";
}

export type JobStatus = "running" | "done" | "failed" | "cancelled";

export interface Job<Result = unknown> {
	readonly id: string;
	readonly capability: string;
	readonly status: JobStatus;
	/** The capability's result once the job is done. */
	readonly result?: Result;
	/** Only while a bulk run is running: rows sent, and rows answered so far. */
	readonly progress?: { readonly total: number; readonly done: number };
	readonly error?: { readonly code: ErrorCode; readonly message: string };
	readonly createdAt?: string;
	readonly updatedAt?: string;
}

export interface WaitOptions {
	/** Give up after this long. Default 31 minutes (the API fails a job after 30). */
	readonly timeoutMs?: number;
	/** First poll interval; never below 2 s. Grows by 1.5x up to 30 s. */
	readonly intervalMs?: number;
}

/** One capability as the API lists it. */
export interface CapabilitySummary extends CapabilityInfo {
	readonly priceEstimateMicro: number;
}

export interface CapabilityDescription extends CapabilitySummary {
	readonly example: unknown;
	readonly requestSchema: Record<string, unknown>;
	readonly resultSchema: Record<string, unknown>;
}
