import { db, EnrichmentStatus } from "@crm/db";
import { settle } from "./enrichment";

const FAILED = "failed: ";

/** Keep public failure reasons free of upstream identifiers and stack traces. */
export function researchTaskFailureReason(
	code: string | null,
	message: string | null,
): string {
	const category = code === "MODEL_CALL_FAILED" ? code : "RESEARCH_FAILED";
	const reason = /schema/i.test(message ?? "")
		? "The research model rejected a tool or response schema."
		: /PRAMAAN_API_KEY/.test(message ?? "")
			? "Research could not access its configured model. Ask the workspace owner to check the research service."
			: "The research turn did not complete.";
	return `${category}: ${reason} Check what completed before retrying research.`;
}

/** A newer explicit request supersedes an older failed attempt, including brand work. */
export async function failedCompanyResearchReason(
	companyId: string,
	client: Pick<typeof db, "agentTask"> = db,
): Promise<string | null> {
	const latest = await client.agentTask.findFirst({
		where: { companyId, kind: "company-profile" },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		select: { outcome: true },
	});
	return latest?.outcome?.startsWith(FAILED)
		? latest.outcome.slice(FAILED.length)
		: null;
}

/** Close a failed turn before waiting/completed events can claim it as successful. */
export async function failResearchTask(
	taskId: string,
	reason: string,
): Promise<void> {
	const subject = await db.$transaction(async (tx) => {
		const task = await tx.agentTask.findUnique({ where: { id: taskId } });
		if (!task) return null;
		const outcome = `${FAILED}${reason}`.slice(0, 500);
		const changed = await tx.agentTask.updateMany({
			where: { id: taskId, OR: [{ finishedAt: null }, { outcome: "ran" }] },
			data: { finishedAt: new Date(), leasedUntil: null, outcome },
		});
		if (!changed.count) return null;
		if (task.kind === "company-profile" && task.companyId) {
			const latest = await tx.agentTask.findFirst({
				where: { companyId: task.companyId, kind: "company-profile" },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				select: { id: true },
			});
			if (latest?.id === taskId) {
				// Earlier brand work is part of this attempt, not a later retry.
				await tx.agentTask.updateMany({
					where: {
						companyId: task.companyId,
						kind: "brand",
						finishedAt: null,
						createdAt: { lte: task.createdAt },
					},
					data: { finishedAt: new Date(), leasedUntil: null, outcome },
				});
				await tx.company.updateMany({
					where: { id: task.companyId },
					data: {
						enrichmentStatus: EnrichmentStatus.FAILED,
						enrichmentError: reason,
						enrichedAt: null,
					},
				});
			}
		}
		return task;
	});
	if (subject) await settle(subject, EnrichmentStatus.FAILED, reason);
}
