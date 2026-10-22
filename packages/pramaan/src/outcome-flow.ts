import { createHash, randomUUID } from "node:crypto";
import { type Pramaan, PramaanError } from "./index";
import type { OutcomeEstimate, OutcomeRun } from "./sdk/types";

export type OutcomeApproval = { confirm?: boolean; plan?: string };
export type OutcomeAttempt =
	| { state: "estimate"; estimate: OutcomeEstimate; summary: string }
	| {
			state: "unavailable" | "refused" | "failed";
			reason: string;
			plan?: unknown;
			needs?: unknown;
	  }
	| { state: "done"; report: OutcomeRun };
const plans = new Map<
	string,
	{ fingerprint: string; expires: number; estimate: OutcomeEstimate }
>();

/** Estimate first; bind confirmation to the exact request for fifteen minutes. Never retry or fall back. */
export async function runOutcomeFlow(
	api: Pramaan,
	id: string,
	input: unknown,
	options: Record<string, unknown> = {},
	approval: OutcomeApproval = {},
	startup = false,
): Promise<OutcomeAttempt> {
	const fingerprint = createHash("sha256")
		.update(JSON.stringify([id, input, options]))
		.digest("hex");
	try {
		const description = await api.outcomes.get(id);
		if (!description.available)
			return {
				state: "unavailable",
				reason: "This service is unavailable. Try again later.",
			};
		for (const [key, saved] of plans)
			if (saved.expires <= Date.now()) plans.delete(key);
		let estimate: OutcomeEstimate;
		if (approval.confirm && approval.plan) {
			const saved = plans.get(approval.plan);
			if (!saved || saved.fingerprint !== fingerprint)
				return {
					state: "refused",
					reason:
						"The request changed or approval expired. Request a new estimate.",
				};
			estimate = saved.estimate;
		} else {
			estimate = await api.outcomes.estimate(id, input, { options });
			if (!estimate.canRun)
				return {
					state: "unavailable",
					reason: "This request cannot run right now.",
				};
			const automatic = startup && !estimate.requiresApproval;
			if (!automatic) {
				plans.set(estimate.plan, {
					fingerprint,
					expires: Date.now() + 15 * 60_000,
					estimate,
				});
				const money = (n: number) => `$${(n / 1_000_000).toFixed(6)}`;
				return {
					state: "estimate",
					estimate,
					summary: `${estimate.priceTypicalMicro === undefined ? `Estimated from ${money(estimate.priceMinMicro)}` : `Usually ${money(estimate.priceTypicalMicro)}`} (at most ${money(estimate.priceMaxMicro)}). ${estimate.steps.map((s) => s.label).join(", ")}. Show this plan and ask for approval before confirming.`,
				};
			}
		}
		if (approval.plan) plans.delete(approval.plan);
		const report = await api.outcomes.run(id, input, {
			options,
			idempotencyKey: randomUUID(),
			...(estimate.requiresApproval ? { plan: estimate.plan } : {}),
		});
		if (report.status !== "done")
			return {
				state: "failed",
				reason:
					"The run did not finish. Check completed steps before trying again.",
			};
		return { state: "done", report };
	} catch (error) {
		if (error instanceof PramaanError && error.code === "forbidden") {
			const detail = error as PramaanError & {
				plan?: unknown;
				needs?: unknown;
			};
			return {
				state: "refused",
				reason:
					"Approval or access is required. Review a fresh plan before trying again.",
				plan: detail.plan,
				needs: detail.needs,
			};
		}
		return {
			state: "failed",
			reason:
				"The service could not confirm the result. Check before trying again.",
		};
	}
}
