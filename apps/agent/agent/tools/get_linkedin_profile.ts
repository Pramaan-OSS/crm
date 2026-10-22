import { defineTool } from "eve/tools";
import { z } from "zod";
import { enabled, PEOPLE, unavailable } from "../lib/capabilities";
import { spend } from "../lib/focus";
import {
	identifyCandidates,
	identityComparison,
} from "../lib/identity-outcome";
import { personByProfileUrl } from "../lib/people";
import { storePortrait } from "../lib/portrait";
import { pramaan } from "../lib/pramaan";

export default defineTool({
	description:
		"Read a profile and compare returned identity keys. Show the estimate and ask approval before calling with confirm and plan.",
	inputSchema: z.object({
		confirm: z.boolean().optional(),
		plan: z.string().optional(),
		slug: z.string().describe("The linkedin.com/in/<slug> handle."),
		email: z.string().describe("The address we are trying to identify."),
		companyName: z.string(),
		companyDomain: z.string(),
		contactId: z
			.string()
			.optional()
			.describe(
				"The CRM contact this candidate is for. Supply it and their photo is copied automatically if — and only if — the profile turns out to be them.",
			),
	}),
	async execute({ slug, email, companyName, contactId, confirm, plan }) {
		if (!(await enabled(PEOPLE))) {
			return { found: false as const, ...unavailable("LinkedIn") };
		}

		const charge = spend(2);
		if (!charge.ok) return { found: false as const, reason: charge.reason };

		const api = pramaan();
		if (!api) return { found: false, reason: "Pramaan is not configured." };
		const attempt = await identifyCandidates(
			api,
			{ email, employer: companyName },
			{ confirm, plan },
		);
		if (attempt.state !== "done") return { found: false, attempt };
		const identity = attempt.report.result as
			| { samePerson?: unknown; candidates?: { profileUrl?: string }[] }
			| undefined;
		const requestedUrl = `https://www.linkedin.com/in/${slug}`;
		const result = await personByProfileUrl(requestedUrl);

		if (result.outcome !== "found") {
			return { found: false as const, reason: result.reason };
		}

		const person = result.person;
		const comparison = identityComparison(identity?.samePerson);
		const candidates = identity?.candidates ?? [];
		const normalize = (url: string) =>
			url
				.toLowerCase()
				.replace(/^https?:\/\/(www\.)?/, "")
				.replace(/\/$/, "");
		const uniqueMatch =
			candidates.length === 1 &&
			candidates[0]?.profileUrl &&
			normalize(candidates[0].profileUrl) === normalize(requestedUrl);
		const verdict = {
			...comparison,
			isSamePerson: comparison.isSamePerson && !!uniqueMatch,
		};

		const portrait =
			contactId && verdict.isSamePerson
				? await storePortrait({
						contactId,
						sourceUrl: person.photoUrl,
						verified: true,
					})
				: null;

		return {
			found: true as const,
			profile: person,
			sourceUrl: person.profileUrl ?? requestedUrl,
			photo: portrait ?? undefined,
			verdict,
			evidence: attempt.report.evidence,
			missing: attempt.report.missing,
		};
	},
});
