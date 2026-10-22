import { defineTool } from "eve/tools";
import { z } from "zod";
import { personForVerification, stampSocialsChecked } from "../lib/crm";
import { focusOn, spend } from "../lib/focus";
import { publicHandles } from "../lib/socials";

export default defineTool({
	description:
		"Find public profile handles. Show the estimate and ask approval before calling with confirm and plan. Write verified results through set_contact_socials.",
	inputSchema: z.object({
		contactId: z.string(),
		confirm: z.boolean().optional(),
		plan: z.string().optional(),
	}),
	async execute({ contactId, confirm, plan }) {
		focusOn({ contactId });

		const person = await personForVerification(contactId);
		if (!person) {
			return { searched: false as const, reason: "No such contact." };
		}

		const charge = spend(2);
		if (!charge.ok) return { searched: false as const, reason: charge.reason };

		const result = await publicHandles(person, { confirm, plan });
		if (result.state !== "done")
			return { searched: false as const, attempt: result };
		await stampSocialsChecked(contactId);
		return {
			searched: true as const,
			handles: result.handles,
			completeness: result.report.completeness,
			missing: result.report.missing,
			evidence: result.report.evidence,
			note: "Only verified handles with evidence can be written through set_contact_socials.",
		};
	},
});
