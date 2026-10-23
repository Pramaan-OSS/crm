import { defineAgent } from "eve";
import { z } from "zod";
import { agentModel } from "../../lib/model";
import { normalizedAuthoredSchema } from "../../lib/registered-tools";

export default defineAgent({
	description:
		"Turn one private CRM builder-chat request into a validated, reviewable team-agent version without deploying it.",
	modelContextWindowTokens: 200_000,
	model: agentModel(),
	outputSchema: z.fromJSONSchema(
		normalizedAuthoredSchema(
			z.object({
				status: z.literal("draft_ready"),
				summary: z.string().min(1).max(1000),
				agentId: z.string().min(1),
				versionId: z.string().min(1),
			}),
			"Agent output",
			"output",
		),
	),
	limits: {
		maxInputTokensPerSession: 100_000,
		maxOutputTokensPerSession: 10_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
});
