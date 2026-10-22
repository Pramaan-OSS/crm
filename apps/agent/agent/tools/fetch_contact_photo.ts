import { storageEnabled } from "@crm/db/blob";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { spend } from "../lib/focus";
import { runPortrait } from "../lib/portrait";
import { assertResearchPurpose } from "../lib/session-purpose";

export default defineTool({
	description:
		"Find and store a contact photo from their recorded profiles or employer page. Never search faces by name; report the source.",
	inputSchema: z.object({
		contactId: z.string(),
		force: z
			.boolean()
			.default(false)
			.describe("Replace an existing photo. Only when a rep asked."),
	}),
	async execute({ contactId, force }, ctx) {
		assertResearchPurpose(ctx);
		if (!storageEnabled()) {
			return {
				stored: false as const,
				configured: false as const,
				reason:
					"This install has no PRAMAAN_API_KEY, so there is nowhere to keep a copy, and " +
					"the source URLs expire. Retrying will not help.",
			};
		}

		return runPortrait({ contactId, spend, force });
	},
});
