import { companyLogoProps } from "@crm/db/images";
import type { Db, Prisma } from "@crm/db";
import { ENRICHMENT_PAGE, pageSize } from "@crm/validation/enrichment-queue";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	type EnrichmentQueueState,
	enrichmentDueLabel,
	enrichmentQueueLine,
	enrichmentQueueState,
} from "./enrichment-copy";

export type EnrichmentQueueSubject =
	| {
			kind: "contact";
			id: string;
			name: string;
			email: string | null;
			imageUrl: string | null;
	  }
	| {
			kind: "company";
			id: string;
			name: string;
			logoUrl: string | null;
			logoDarkUrl: string | null;
			logoTone: string | null;
	  };

export type EnrichmentQueueRow = {
	id: string;
	state: EnrichmentQueueState;
	line: string;
	startedAt: string | null;
	subject: EnrichmentQueueSubject;
};

export type EnrichmentScheduledRow = {
	id: string;
	due: string;
	subject: EnrichmentQueueSubject;
};

export type EnrichmentQueue = {
	rows: EnrichmentQueueRow[];
	total: number;
	scheduled: EnrichmentScheduledRow[];
	scheduledTotal: number;
};

const TASK_SELECT = {
	id: true,
	contactId: true,
	companyId: true,
	dealId: true,
	kind: true,
	attempts: true,
	leasedUntil: true,
	startedAt: true,
	dueAt: true,
	finishedAt: true,
	outcome: true,
} as const;

type QueuedTask = {
	id: string;
	contactId: string | null;
	companyId: string | null;
	kind: string;
	attempts: number;
	leasedUntil: Date | null;
	startedAt: Date | null;
	dueAt: Date;
	finishedAt: Date | null;
	outcome: string | null;
};

@Injectable()
export class EnrichmentService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async queue(limit: number = ENRICHMENT_PAGE): Promise<EnrichmentQueue> {
		const take = pageSize(limit);
		const now = new Date();

		const named: Prisma.AgentTaskWhereInput = {
			finishedAt: null,
			OR: [{ contactId: { not: null } }, { companyId: { not: null } }],
		};

		const dueWhere: Prisma.AgentTaskWhereInput = {
			...named,
			dueAt: { lte: now },
		};

		const scheduledWhere: Prisma.AgentTaskWhereInput = {
			...named,
			dueAt: { gt: now },
		};

		let [tasks, total, booked, scheduledTotal] = await Promise.all([
			this.db.agentTask.findMany({
				where: dueWhere,
				orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
				take,
				select: TASK_SELECT,
			}),
			this.db.agentTask.count({ where: dueWhere }),
			this.db.agentTask.findMany({
				where: scheduledWhere,
				orderBy: [{ dueAt: "asc" }],
				take,
				select: TASK_SELECT,
			}),
			this.db.agentTask.count({ where: scheduledWhere }),
		]);

		const everyTask: QueuedTask[] = [...tasks, ...booked];
		const contactIds = unique(everyTask.map((task) => task.contactId));
		const companyIds = unique(everyTask.map((task) => task.companyId));

		const [contacts, companies] = await Promise.all([
			contactIds.length === 0
				? []
				: this.db.contact.findMany({
						where: { id: { in: contactIds } },
						select: {
							id: true,
							firstName: true,
							lastName: true,
							email: true,
							imageUrl: true,
						},
					}),
			companyIds.length === 0
				? []
				: this.db.company.findMany({
						where: { id: { in: companyIds } },
						select: {
							id: true,
							name: true,
							iconUrl: true,
							logoUrl: true,
							iconDarkUrl: true,
							logoDarkUrl: true,
							iconTone: true,
						},
					}),
		]);

		const contactById = new Map(
			contacts.map((contact) => [
				contact.id,
				{
					kind: "contact" as const,
					id: contact.id,
					name:
						[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
						contact.email ||
						"Unnamed contact",
					email: contact.email,
					imageUrl: contact.imageUrl,
				},
			]),
		);

		const companyById = new Map(
			companies.map((company) => [
				company.id,
				{
					kind: "company" as const,
					id: company.id,
					name: company.name,
					logoUrl: companyLogoProps(company).src,
					logoDarkUrl: companyLogoProps(company).darkSrc,
					logoTone: companyLogoProps(company).tone,
				},
			]),
		);

		const subjectOf = (task: QueuedTask): EnrichmentQueueSubject | undefined =>
			task.contactId
				? contactById.get(task.contactId)
				: task.companyId
					? companyById.get(task.companyId)
					: undefined;

		// A queued task whose record was deleted can never run: close it here,
		// without a model call, instead of letting it sit in the queue forever.
		const orphaned = everyTask.filter(
			(task) => task.finishedAt === null && !subjectOf(task),
		);
		if (orphaned.length > 0) {
			await this.db.agentTask.updateMany({
				where: { id: { in: orphaned.map((task) => task.id) } },
				data: {
					finishedAt: now,
					outcome: "The record was deleted before this could run.",
				},
			});
		}

		// The counts above ran before the orphans were closed; keep this
		// response honest by taking them back out.
		const closedDue = orphaned.filter((task) => task.dueAt <= now).length;
		const closedScheduled = orphaned.length - closedDue;
		total = Math.max(0, total - closedDue);
		scheduledTotal = Math.max(0, scheduledTotal - closedScheduled);

		const rows: EnrichmentQueueRow[] = [];

		for (const task of tasks) {
			const subject = subjectOf(task);
			if (!subject) continue;

			const state = enrichmentQueueState(task.attempts, task.leasedUntil, now);

			rows.push({
				id: task.id,
				state,
				line: enrichmentQueueLine(state, task.kind, task.outcome),
				startedAt: task.startedAt?.toISOString() ?? null,
				subject,
			});
		}

		const scheduled: EnrichmentScheduledRow[] = [];

		for (const task of booked) {
			const subject = subjectOf(task);
			if (!subject) continue;

			scheduled.push({
				id: task.id,
				due: enrichmentDueLabel(task.dueAt, now),
				subject,
			});
		}

		return { rows, total, scheduled, scheduledTotal };
	}
}

function unique(ids: readonly (string | null)[]): string[] {
	return [...new Set(ids.filter((id): id is string => id !== null))];
}
