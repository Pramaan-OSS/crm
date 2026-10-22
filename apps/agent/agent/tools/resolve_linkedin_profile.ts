import { defineTool } from "eve/tools";
import { z } from "zod";
import { enabled, PEOPLE, unavailable } from "../lib/capabilities";
import { CONTEXT } from "../lib/context-config";
import { spend } from "../lib/focus";
import { identityComparison, resolveIdentity } from "../lib/identity-outcome";
import { pramaan } from "../lib/pramaan";

export default defineTool({
	description:
		"Resolve a work email to a LinkedIn profile using name/employer clues. Show its estimate and ask approval before calling with confirm and plan. For an existing profile, use get_linkedin_profile.",
	inputSchema: z.object({
		confirm: z.boolean().optional(),
		plan: z.string().optional(),
		email: z.string().describe("The contact's work email address."),
		companyName: z.string().describe("The company the CRM has them at."),
		companyDomain: z
			.string()
			.describe("The company's own domain, for checking the employer."),
		firstName: z
			.string()
			.optional()
			.describe("The first name, if the CRM holds one."),
		lastName: z
			.string()
			.optional()
			.describe("The last name, if the CRM holds one."),
	}),
	async execute({ email, confirm, plan }) {
		if (!(await enabled(PEOPLE))) {
			return { found: false as const, ...unavailable("LinkedIn") };
		}

		const charge = spend(CONTEXT.people.enrichCost);
		if (!charge.ok) return { found: false as const, reason: charge.reason };

		const api = pramaan();
		if (!api) return { found: false, reason: "Pramaan is not configured." };
		const attempt = await resolveIdentity(api, email, { confirm, plan });
		if (attempt.state !== "done") return { found: false, attempt };
		const result = attempt.report.result as
			| {
					profileUrl?: string;
					person?: unknown;
					company?: unknown;
					samePerson?: unknown;
			  }
			| undefined;
		return {
			found: !!result?.profileUrl,
			profile: result?.person,
			company: result?.company,
			sourceUrl: result?.profileUrl,
			verdict: identityComparison(result?.samePerson),
			evidence: attempt.report.evidence,
			missing: attempt.report.missing,
			note: "A lookup result is not proof. unsure or different must not merge or verify records.",
		};
	},
});
