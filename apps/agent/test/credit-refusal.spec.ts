import { afterAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { MAX_ATTEMPTS } from "@crm/db/agent-tasks";
import { PramaanError } from "@crm/pramaan";
import {
	claimDue,
	completeTask,
	isCreditRefusal,
	terminateTask,
} from "../agent/lib/tasks";

// A credit refusal will not change on retry. The dispatch path must end the
// task's retry ladder when it sees one: re-leasing would only refuse again
// (and, after a top-up, spend without anyone asking). The panel then shows
// the plain "Not enough credit — top up to continue" line.

const suffix = Date.now();

async function seedTask(kind: string): Promise<string> {
	const company = await db.company.create({
		data: {
			name: `credit-spec-${suffix}-${kind}`,
			domain: `credit-spec-${suffix}-${kind}.example.test`,
			enrichmentStatus: "PENDING",
		},
		select: { id: true },
	});
	const task = await db.agentTask.create({
		data: {
			kind,
			reason: "credit spec",
			companyId: company.id,
			dueAt: new Date(),
		},
		select: { id: true },
	});
	return task.id;
}

const cleanup = async () => {
	const tasks = await db.agentTask.findMany({
		where: { reason: "credit spec" },
		select: { id: true, companyId: true },
	});
	for (const task of tasks) {
		if (task.companyId) {
			await db.agentTask.deleteMany({ where: { companyId: task.companyId } });
			await db.company.deleteMany({ where: { id: task.companyId } });
		}
	}
	await db.agentTask.deleteMany({ where: { reason: "credit spec" } });
};

afterAll(async () => {
	await cleanup();
	await db.$disconnect();
});

describe("a credit refusal ends the retry ladder", () => {
	it("terminateTask finishes the task at max attempts, so claimDue skips it", async () => {
		const taskId = await seedTask("company-profile");

		const claimed = await claimDue(5, { only: ["company-profile"] });
		expect(claimed.some((task) => task.id === taskId)).toBe(true);

		const subject = await terminateTask(
			taskId,
			"Not enough credit — top up, then requeue this task.",
		);
		expect(subject?.id).toBe(taskId);

		const row = await db.agentTask.findUnique({ where: { id: taskId } });
		expect(row?.finishedAt).not.toBeNull();
		expect(row?.attempts).toBe(MAX_ATTEMPTS);
		expect(row?.outcome).toContain("Not enough credit");

		const again = await claimDue(5, { only: ["company-profile"] });
		expect(again.some((task) => task.id === taskId)).toBe(false);
	});

	it("terminateTask leaves an already-finished task alone", async () => {
		const taskId = await seedTask("identify");
		await completeTask(taskId, "done");

		const subject = await terminateTask(taskId, "late refusal");
		expect(subject).toBeNull();

		const row = await db.agentTask.findUnique({ where: { id: taskId } });
		expect(row?.outcome).toBe("done");
		expect(row?.attempts).toBe(0);
	});

	it("matches the live refusal wording, and only that", () => {
		// The exact wording from the platform's live refusal.
		expect(
			isCreditRefusal(
				"PramaanError: Not enough credit. This request can cost up to $0.362294. Top up to continue.",
			),
		).toBe(true);
		expect(isCreditRefusal("rate limited: try later")).toBe(false);
		expect(isCreditRefusal("upstream unavailable")).toBe(false);
	});
});
