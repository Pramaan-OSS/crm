import { pramaanKeySet } from "@crm/pramaan";
import { enrichmentQueueInput } from "@crm/validation/enrichment-queue";
import { Inject } from "@nestjs/common";
import { Input, Query, Router, UseMiddlewares } from "nestjs-trpc";
import { z } from "zod";
import { bridge } from "../agent/bridge";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import { EnrichmentService } from "./enrichment.service";

const enrichmentContactSubjectOutput = z.object({
	kind: z.literal("contact"),
	id: z.string(),
	name: z.string(),
	email: z.string().nullable(),
	imageUrl: z.string().nullable(),
});

const enrichmentCompanySubjectOutput = z.object({
	kind: z.literal("company"),
	id: z.string(),
	name: z.string(),
	logoUrl: z.string().nullable(),
	logoDarkUrl: z.string().nullable(),
	logoTone: z.string().nullable(),
});

const enrichmentQueueSubjectOutput = z.discriminatedUnion("kind", [
	enrichmentContactSubjectOutput,
	enrichmentCompanySubjectOutput,
]);

const enrichmentQueueRowOutput = z.object({
	id: z.string(),
	state: z.enum(["running", "queued", "failed"]),
	line: z.string(),
	startedAt: z.string().nullable(),
	subject: enrichmentQueueSubjectOutput,
});

const enrichmentScheduledRowOutput = z.object({
	id: z.string(),
	due: z.string(),
	subject: enrichmentQueueSubjectOutput,
});

const enrichmentQueueOutput = z.object({
	rows: z.array(enrichmentQueueRowOutput),
	total: z.number(),
	scheduled: z.array(enrichmentScheduledRowOutput),
	scheduledTotal: z.number(),
});

const researchStatusOutput = z.object({
	runnable: z.boolean(),
	reason: z.enum(["bridge", "platform-key"]).nullable(),
});

@Router({ alias: "enrichment" })
@UseMiddlewares(AuthMiddleware)
export class EnrichmentRouter {
	constructor(
		@Inject(EnrichmentService) private readonly enrichment: EnrichmentService,
	) {}

	@Query({
		input: enrichmentQueueInput,
		output: enrichmentQueueOutput,
		meta: restMeta("GET", "/enrichment/queue", ["Enrichment"]),
	})
	async queue(@Input() input: z.infer<typeof enrichmentQueueInput>) {
		return this.enrichment.queue(input.limit);
	}

	/** Whether research can run at all: the agent bridge and the platform key exist. */
	@Query({
		output: researchStatusOutput,
		meta: restMeta("GET", "/enrichment/status", ["Enrichment"]),
	})
	async status() {
		if (!bridge()) {
			return { runnable: false, reason: "bridge" as const };
		}
		if (!pramaanKeySet()) {
			return { runnable: false, reason: "platform-key" as const };
		}
		return { runnable: true, reason: null };
	}
}
