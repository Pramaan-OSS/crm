import { afterEach, expect, test } from "bun:test";
import { db, EnrichmentStatus } from "@crm/db";
import { crmEvents, taskToken } from "../agent/channels/crm";
import { failedCompanyResearchReason } from "../agent/lib/research-task-failure";
import { claimDue, scheduleTask } from "../agent/lib/tasks";

const ids: string[] = [];
afterEach(async () => {
	await db.agentTask.deleteMany({ where: { companyId: { in: ids } } });
	await db.company.deleteMany({ where: { id: { in: ids.splice(0) } } });
});
async function running() {
	const company = await db.company.create({
		data: {
			name: "Failed research fixture",
			domain: `failure-${crypto.randomUUID()}.example.test`,
			enrichmentStatus: "COMPLETE",
			enrichedAt: new Date(),
			industry: "Found industry",
		},
	});
	ids.push(company.id);
	const task = await db.agentTask.create({
		data: {
			companyId: company.id,
			kind: "company-profile",
			reason: "test",
			dueAt: new Date(),
			attempts: 1,
			startedAt: new Date(),
			leasedUntil: new Date(Date.now() + 60000),
		},
	});
	return { company, task, channel: { continuationToken: taskToken(task.id) } };
}
async function event(name: string, data: unknown, channel: unknown) {
	// Invoke the production channel handlers in the same order the runtime emits
	// them, without booting a scheduler or connecting a generation service.
	await (
		crmEvents as unknown as Record<
			string,
			(data: unknown, channel: unknown) => Promise<void>
		>
	)[name]!(data, channel);
}
for (const terminal of ["turn.failed", "session.failed"])
	test(`${terminal} followed by waiting and completed retains failure and allows explicit retry`, async () => {
		const { company, task, channel } = await running();
		await event(
			terminal,
			{
				code: "MODEL_CALL_FAILED",
				message: "Schema must use the supported bounded JSON Schema subset.",
			},
			channel,
		);
		await event("session.waiting", {}, channel);
		await event("session.completed", {}, channel);
		const ended = await db.agentTask.findUnique({ where: { id: task.id } });
		expect(ended?.outcome).toContain("failed: MODEL_CALL_FAILED");
		expect(ended?.outcome).toContain("schema");
		expect(ended?.finishedAt).not.toBeNull();
		expect(ended?.leasedUntil).toBeNull();
		const record = await db.company.findUnique({ where: { id: company.id } });
		expect(record?.enrichmentStatus).toBe(EnrichmentStatus.FAILED);
		expect(record?.enrichmentError).toContain("MODEL_CALL_FAILED");
		expect(record?.enrichedAt).toBeNull();
		expect(record?.industry).toBe("Found industry");
		expect(
			(await claimDue(10, { only: ["company-profile"] })).some(
				(t) => t.id === task.id,
			),
		).toBe(false);
		const next = await scheduleTask({
			companyId: company.id,
			kind: "company-profile",
			reason: "Explicit retry",
			dueAt: new Date(),
		});
		expect(next.id).not.toBe(task.id);
		expect(await failedCompanyResearchReason(company.id)).toBeNull();
	});
test("late failure from an older request does not overwrite a newer request", async () => {
	const { company, task, channel } = await running();
	await db.agentTask.create({
		data: {
			companyId: company.id,
			kind: "company-profile",
			reason: "New request",
			dueAt: new Date(),
			createdAt: new Date(Date.now() + 1000),
		},
	});
	await db.company.update({
		where: { id: company.id },
		data: { enrichmentStatus: "PENDING", enrichmentError: null },
	});
	await event(
		"turn.failed",
		{ code: "MODEL_CALL_FAILED", message: "Failed" },
		channel,
	);
	expect(
		(await db.agentTask.findUnique({ where: { id: task.id } }))?.outcome,
	).toContain("failed:");
	expect(
		(await db.company.findUnique({ where: { id: company.id } }))
			?.enrichmentStatus,
	).toBe("PENDING");
});
test("duplicate failure notifications remain stable", async () => {
	const { company, channel } = await running();
	await event(
		"turn.failed",
		{ code: "MODEL_CALL_FAILED", message: "Schema rejected" },
		channel,
	);
	await event(
		"session.failed",
		{ code: "MODEL_CALL_FAILED", message: "Later generic failure" },
		channel,
	);
	expect(
		(await db.company.findUnique({ where: { id: company.id } }))
			?.enrichmentError,
	).toContain("schema");
});

test("later successful brand work keeps the research failure visible", async () => {
	const { FakePramaan } = await import("@crm/pramaan/fake");
	const { runBrand } = await import("../agent/lib/brand");
	const { company, channel } = await running();
	await event(
		"turn.failed",
		{ code: "MODEL_CALL_FAILED", message: "Schema rejected" },
		channel,
	);
	const fake = new FakePramaan({
		"companies.enrich": () => ({
			name: "Enriched fixture",
			domain: company.domain,
			description: "Found company facts",
			industry: "Found industry",
		}),
	});
	fake.routeOutcomes({
		get: () => ({ available: true }),
		estimate: () => ({
			canRun: true,
			requiresApproval: true,
			plan: "brand-failure-fixture",
			steps: [],
			priceMinMicro: 0,
			priceMaxMicro: 0,
		}),
		run: () => ({
			status: "done",
			completeness: "partial",
			result: {},
			missing: [{ field: "logoFile" }],
			evidence: {},
		}),
	});
	expect(
		(await runBrand({ companyId: company.id, client: fake })).attempt?.state,
	).toBe("estimate");
	expect(
		(
			await runBrand({
				companyId: company.id,
				client: fake,
				approval: { confirm: true, plan: "brand-failure-fixture" },
			})
		).enriched,
	).toBe(true);
	const record = await db.company.findUnique({ where: { id: company.id } });
	expect(record?.description).toBe("Found company facts");
	expect(record?.enrichmentStatus).toBe("FAILED");
	expect(record?.enrichmentError).toContain("MODEL_CALL_FAILED");
	expect(fake.callsTo("companies.enrich")).toHaveLength(1);
});

test("first model call failure closes the outstanding brand task without retrying", async () => {
	const { FakePramaan } = await import("@crm/pramaan/fake");
	const { createPramaanChatModel } = await import(
		"../agent/lib/pramaan-chat-model"
	);
	const { company, task, channel } = await running();
	const brand = await db.agentTask.create({
		data: {
			companyId: company.id,
			kind: "brand",
			reason: "Same request",
			dueAt: new Date(),
			createdAt: new Date(task.createdAt.getTime() - 1),
			startedAt: new Date(),
			leasedUntil: new Date(Date.now() + 60000),
			attempts: 1,
		},
	});
	const newer = await db.agentTask.create({
		data: {
			companyId: company.id,
			kind: "brand",
			reason: "Later independent request",
			dueAt: new Date(),
			createdAt: new Date(task.createdAt.getTime() + 1000),
		},
	});
	const fake = new FakePramaan({
		"llm.chat": () => {
			throw new Error("Model service unavailable");
		},
	});
	await expect(
		createPramaanChatModel({ pramaan: fake }).doGenerate({
			prompt: [{ role: "user", content: "Research this company." }],
		}),
	).rejects.toThrow();
	await event(
		"turn.failed",
		{ code: "MODEL_CALL_FAILED", message: "Model service unavailable" },
		channel,
	);
	await event("session.waiting", {}, channel);
	for (const id of [task.id, brand.id]) {
		const ended = await db.agentTask.findUniqueOrThrow({ where: { id } });
		expect(ended.finishedAt).not.toBeNull();
		expect(ended.leasedUntil).toBeNull();
		expect(ended.outcome).toContain("failed: MODEL_CALL_FAILED");
	}
	expect(
		(await db.agentTask.findUniqueOrThrow({ where: { id: newer.id } }))
			.finishedAt,
	).toBeNull();
	expect(fake.callsTo("llm.chat")).toHaveLength(1);
	expect(
		(await db.company.findUniqueOrThrow({ where: { id: company.id } }))
			.enrichmentStatus,
	).toBe("FAILED");
});
