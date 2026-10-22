import { defineTool } from "eve/tools";
import { z } from "zod";
import { enabled, PEOPLE, unavailable } from "../lib/capabilities";
import { contactProfileSlug } from "../lib/crm";
import { spend } from "../lib/focus";
import { personByProfileUrl } from "../lib/people";

export default defineTool({
	description:
		"Read a known contact's LinkedIn biography and work history; not an identity check.",
	inputSchema: z.object({
		contactId: z.string(),
	}),
	async execute({ contactId }) {
		if (!(await enabled(PEOPLE))) {
			return { found: false as const, ...unavailable("LinkedIn") };
		}

		const profileRef = await contactProfileSlug(contactId);
		if (!profileRef) {
			return {
				found: false as const,
				reason: "This contact has no LinkedIn URL on file.",
			};
		}

		const charge = spend(2);
		if (!charge.ok) return { found: false as const, reason: charge.reason };

		const result = await personByProfileUrl(profileRef.profileUrl);
		if (result.outcome !== "found") {
			return { found: false as const, reason: result.reason };
		}

		return {
			found: true as const,
			profile: result.person,
			sourceUrl: profileRef.profileUrl,
			note: "Everything here is self-reported by the person. Write only what it says.",
		};
	},
});
