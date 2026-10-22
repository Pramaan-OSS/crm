import { defineTool } from "eve/tools";
import { z } from "zod";
import { readDealHistory } from "../lib/accounts";
import { focusOn } from "../lib/focus";

export default defineTool({
	description:
		"Read deal stage history, value, closing date, contacts, correspondence, meetings and notes. Start deal research here.",
	inputSchema: z.object({
		dealId: z.string(),
		threads: z
			.number()
			.int()
			.min(1)
			.max(20)
			.default(5)
			.describe("How many recent threads to read."),
	}),
	async execute({ dealId, threads }) {
		const history = await readDealHistory(dealId, { threads });
		if (!history) return { found: false as const, reason: "No such deal." };

		focusOn({ companyId: history.company.id });

		return { found: true as const, ...history };
	},
});
