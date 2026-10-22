import { defineTool } from "eve/tools";
import { z } from "zod";
import { runBrand } from "../lib/brand";
import { spend } from "../lib/focus";
import { assertResearchPurpose } from "../lib/session-purpose";

export default defineTool({
	description:
		"Fill empty company brand, industry, location and social fields by domain. Preserve human-entered values. Show the returned estimate and ask the person before calling again with confirm and plan.",
	inputSchema: z.object({
		companyId: z.string(),
		confirm: z.boolean().optional(),
		plan: z.string().optional(),
		fresh: z
			.boolean()
			.default(false)
			.describe(
				"Bypass the vendor's ~90-day cache. Only when a rep has asked for a fresh look.",
			),
	}),
	async execute({ companyId, fresh, confirm, plan }, ctx) {
		assertResearchPurpose(ctx);
		const result = await runBrand({
			companyId,
			fresh,
			spend,
			approval: { confirm, plan },
		});

		if (!result.enriched) {
			return {
				enriched: false as const,
				reason: result.reason,
				attempt: result.attempt,
				retryable: result.retryable,
			};
		}

		const filled = result.filled ?? [];

		return {
			enriched: true as const,
			attempt: result.attempt,
			filled,
			mirrored: result.mirrored ?? [],
			note:
				filled.length === 0
					? "Everything it returned was already on the record."
					: undefined,
		};
	},
});
