import { defineTool } from "eve/tools";
import { z } from "zod";
import { readDealHistory } from "../lib/accounts";
import { readCrmHistory } from "../lib/crm";
import { spend } from "../lib/focus";
import {
	meetingContext,
	meetingStatements,
	prepareMeeting,
} from "../lib/meeting-outcome";
import { pramaan } from "../lib/pramaan";
import { assertResearchPurpose } from "../lib/session-purpose";

export default defineTool({
	description:
		"Prepare a sourced meeting brief from this contact's correspondence and deal history. Show its estimate, ask the person, then confirm the exact plan. Keep caller-supplied evidence labelled when presenting the brief.",
	inputSchema: z.object({
		contactId: z.string(),
		confirm: z.boolean().optional(),
		plan: z.string().optional(),
	}),
	async execute({ contactId, confirm, plan }, ctx) {
		assertResearchPurpose(ctx);
		const history = await readCrmHistory(contactId, { threads: 5 });
		if (!history) return { prepared: false, reason: "No such contact." };
		const domain = history.contact.company?.domain;
		if (!domain)
			return {
				prepared: false,
				reason:
					"A company domain is required. Keep working from local CRM history.",
			};
		const api = pramaan();
		if (!api) return { prepared: false, reason: "Pramaan is not configured." };
		const deals = await Promise.all(
			history.deals.slice(0, 3).map((deal) => readDealHistory(deal.id)),
		);
		const context = meetingContext(
			deals.map(
				(deal) =>
					deal && {
						deal: deal.deal,
						stageHistory: deal.stageHistory,
						notes: deal.notes,
					},
			),
			history.threads,
			history.meetings,
		);
		const privateContext = context.privateContext;
		const localHistoryCut = context.cut || history.deals.length > 3;

		const charge = spend(2);
		if (!charge.ok) return { prepared: false, reason: charge.reason };
		const attempt = await prepareMeeting(
			api,
			{
				domain,
				personName: history.contact.fullName,
				...(history.contact.email ? { email: history.contact.email } : {}),
				privateContext,
			},
			{ confirm, plan },
		);
		if (attempt.state !== "done") return { prepared: false, attempt };
		return {
			prepared: true,
			statements: meetingStatements(attempt.report.result),
			completeness: localHistoryCut ? "partial" : attempt.report.completeness,
			evidence: attempt.report.evidence,
			missing: [
				...attempt.report.missing,
				...(localHistoryCut
					? [
							{
								field: "privateContext",
								reason:
									"Local history was shortened; omitted material was not checked.",
							},
						]
					: []),
			],
			localHistoryCut,
			note: "Keep each statement's evidence and caller-supplied label. Do not turn unavailable checks into negative findings. Existing record-writing evidence rules still apply.",
		};
	},
});
