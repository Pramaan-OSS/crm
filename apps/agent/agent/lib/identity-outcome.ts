import {
	type OutcomeApproval,
	type Pramaan,
	runOutcomeFlow,
} from "@crm/pramaan";
import { z } from "zod";

const comparison = z.object({
	verdict: z.enum(["same", "different", "unsure"]),
	matchedKeys: z.array(z.enum(["email", "phone", "linkedinUrl"])),
	conflictingKeys: z.array(z.string()),
	evidence: z.array(z.string()),
	reason: z.string().optional(),
});
export function identityComparison(value: unknown) {
	const parsed = comparison.safeParse(value);
	if (!parsed.success)
		return {
			verdict: "unsure" as const,
			matchedKeys: [],
			conflictingKeys: [],
			evidence: [],
			isSamePerson: false,
			reason: "No comparable returned keys.",
		};
	const item = parsed.data;
	return {
		...item,
		isSamePerson:
			item.verdict === "same" &&
			item.matchedKeys.length > 0 &&
			item.conflictingKeys.length === 0 &&
			item.evidence.length > 0,
	};
}
export function resolveIdentity(
	api: Pramaan,
	email: string,
	approval: OutcomeApproval = {},
) {
	return runOutcomeFlow(
		api,
		"lead.identity.resolve",
		{ email },
		{ company: true },
		approval,
	);
}
export function identifyCandidates(
	api: Pramaan,
	hints: { email: string; name?: string; employer?: string },
	approval: OutcomeApproval = {},
) {
	return runOutcomeFlow(api, "contact.identify", hints, {}, approval);
}
