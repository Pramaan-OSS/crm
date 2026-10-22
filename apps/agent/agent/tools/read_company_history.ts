import { defineTool } from "eve/tools";
import { z } from "zod";
import { readCompanyHistory } from "../lib/accounts";
import { focusOn } from "../lib/focus";

export default defineTool({
	description:
		"Read company contacts, deals, full mail bodies, meetings and notes. Start company research here.",
	inputSchema: z.object({
		companyId: z.string(),
		threads: z
			.number()
			.int()
			.min(1)
			.max(20)
			.default(5)
			.describe("How many recent threads to read across the whole account."),
		people: z
			.number()
			.int()
			.min(1)
			.max(100)
			.default(25)
			.describe("How many contacts to list."),
	}),
	async execute({ companyId, threads, people }) {
		focusOn({ companyId });

		const history = await readCompanyHistory(companyId, { threads, people });
		if (!history) return { found: false as const, reason: "No such company." };

		return {
			found: true as const,
			...history,
			note:
				history.people.length === 0
					? "We have no contacts on file at this company, so there is nobody here to research yet."
					: "Every person above carries their contact id — use it directly with read_crm_history, identify_contact or record_fact. Never ask a rep for an id that is in this list.",
		};
	},
});
