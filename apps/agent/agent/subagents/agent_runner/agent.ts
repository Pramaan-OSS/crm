import { defineAgent } from "eve";
import { z } from "zod";
import { normalizedAuthoredSchema } from "../../lib/registered-tools";
import { agentModel } from "../../lib/model";
import { attribute, purposeOf } from "../../lib/session-purpose";

export default defineAgent({
	description:
		"Execute one immutable deployed CRM agent version and persist its result and every side effect.",
	modelContextWindowTokens: 200_000,
	model: agentModel(),
	outputSchema: z.fromJSONSchema(
		normalizedAuthoredSchema(
			z.object({
				summary: z.string().min(1).max(1000),
				result: z.record(z.string(), z.unknown()).nullable(),
			}),
			"Agent output",
			"output",
		),
	),
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 40_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
});
