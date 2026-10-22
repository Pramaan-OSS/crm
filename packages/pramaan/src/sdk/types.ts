// Only product-specific extensions remain local; shared contracts come from the package.
import type {
	OutcomeRunOptions as SdkOutcomeRunOptions,
	OutcomeRunStep,
	StreamEvent,
} from "@pramaan/sdk";
export type {
	ErrorCode,
	EffectClass,
	CapabilityInfo,
	Estimate,
	JobStatus,
	Job,
	CapabilitySummary,
	CapabilityDescription,
	OutcomeSummary,
	OutcomeStep,
	OutcomeDescription,
	OutcomeEstimate,
	OutcomeRunStep,
} from "@pramaan/sdk";
export type WaitOptions = import("@pramaan/sdk").WaitOptions & {
	readonly signal?: AbortSignal;
	readonly fresh?: boolean;
};
export type OutcomeRunOptions = SdkOutcomeRunOptions & {
	readonly retry?: boolean;
	readonly signal?: AbortSignal;
	readonly fresh?: boolean;
};
export type LlmChatStreamEvent = StreamEvent<unknown>;
export interface OutcomeRun {
	readonly outcome: string;
	readonly version: number;
	readonly plan: string;
	readonly status: "done" | "failed" | "declined" | "cancelled";
	readonly completeness?: "complete" | "partial";
	readonly result?: unknown;
	readonly evidence: Record<string, unknown>;
	readonly missing: ReadonlyArray<unknown>;
	readonly steps: ReadonlyArray<OutcomeRunStep>;
	readonly error?: unknown;
	readonly cost: {
		readonly holdMicro: number;
		readonly chargedMicro: number;
		readonly capabilities: ReadonlyArray<{
			readonly id: string;
			readonly calls: number;
			readonly chargedMicro: number;
		}>;
	};
}

export type RunOptions = import("@pramaan/sdk").RunOptions & {
	readonly fresh?: boolean;
};
