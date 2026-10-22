import { defineTool } from "eve/tools";
import { z } from "zod";
import { enabled, RESEARCH, unavailable } from "../lib/capabilities";
import { spend } from "../lib/focus";
import { ask } from "../lib/research";

export default defineTool({
	description:
		"Research cited public sales context for a person or company, not identity or job-title verification.",
	inputSchema: z.object({
		question: z
			.string()
			.describe(
				"A specific question, e.g. 'What has Acme announced in the last 6 months?'",
			),
		deep: z
			.boolean()
			.default(false)
			.describe("Reason over more sources. Slower, better for prep briefs."),
	}),
	async execute({ question, deep }) {
		if (!(await enabled(RESEARCH))) return unavailable("web research");

		const charge = spend(deep ? 2 : 1);
		if (!charge.ok) return { ok: false as const, reason: charge.reason };

		const answer = await ask(question, {
			mode: deep ? "thorough" : "fast",
			system:
				"You are researching for a B2B sales rep. Be specific and factual. " +
				"State only what your sources support, prefer recent information, and " +
				"say plainly when you do not know. Never speculate about a person.",
		});

		if (!answer.ok) return { ok: false as const, reason: answer.reason };

		return {
			ok: true as const,
			answer: answer.data.text,
			citations: answer.data.citations,
			note: "Only write claims that have a citation.",
		};
	},
});
