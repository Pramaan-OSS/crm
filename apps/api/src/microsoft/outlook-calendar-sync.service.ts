import {
	ActivityType,
	type Db,
	type MailboxSyncModel as MailboxSync,
	RecordSource,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import {
	MailboxMatchService,
	type MatchContext,
} from "../mailbox/mailbox-match.service";
import { isMachineAddress, type Participant } from "../mailbox/participants";
import { SyncStateService } from "../mailbox/sync-state.service";
import { AppsConnectionService } from "../pramaan/apps-connection.service";

const MAX_PAGES_PER_TICK = 5;
const HORIZON_DAYS = 180;

/** Catalogue action handles tried in order until one resolves. */
const ACTION_CANDIDATES = [
	"calendar_view",
	"list_calendar_view_delta",
] as const;

export type OutlookCalendarSyncOutcome = {
	source: "outlook_calendar";
	userId: string;
	status: "synced" | "skipped" | "reconnect" | "rate-limited" | "failed";
	eventsWritten?: number;
	eventsRemoved?: number;
	reason?: string;
};

type RawOutlookEvent = {
	id?: unknown;
	subject?: unknown;
	start?: unknown;
	end?: unknown;
	location?: unknown;
	body?: unknown;
	isCancelled?: unknown;
	organizer?: unknown;
	attendees?: unknown;
};

type OutlookEvent = {
	id: string;
	subject: string | null;
	startsAt: Date;
	endsAt: Date;
	location: string | null;
	description: string | null;
	organizer: string | null;
	attendees: { email: string; name: string | null }[];
	cancelled: boolean;
};

@Injectable()
export class OutlookCalendarSyncService {
	private readonly logger = new Logger(OutlookCalendarSyncService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly apps: AppsConnectionService,
		private readonly match: MailboxMatchService,
		private readonly state: SyncStateService,
		private readonly stamp: ActivityStampService,
		private readonly agent: AgentTriggerService,
	) {}

	async sync(row: MailboxSync): Promise<OutlookCalendarSyncOutcome> {
		const token = await this.apps.statusFor(row.userId, "outlook");

		if (token !== "active") {
			return {
				source: "outlook_calendar",
				userId: row.userId,
				status: token === "pending" ? "skipped" : "reconnect",
				reason: "The Outlook connection is not finished.",
			};
		}

		await this.state.markRunning(row.id);

		const [internal, suppressedDomains, suppressedEmails] = await Promise.all([
			this.match.internalIdentity(),
			this.match.suppressedDomains(),
			this.match.suppressedEmails(),
		]);

		const context = {
			ourAddresses: internal.addresses,
			ourDomains: internal.domains,
			suppressedDomains,
			suppressedEmails,
		};

		let written = 0;
		let removed = 0;

		try {
			const events = await this.listEvents(row.userId);

			for (const event of events) {
				const applied = await this.apply(event, row, context);
				if (applied === "written") written += 1;
				if (applied === "removed") removed += 1;
			}

			await this.state.settle(row.id, {
				cursor: new Date().toISOString(),
				status: "RUNNING",
			});

			this.logger.log({
				message: "Outlook calendar sync complete",
				userId: row.userId,
				eventsWritten: written,
				eventsRemoved: removed,
			});

			return {
				source: "outlook_calendar",
				userId: row.userId,
				status: "synced",
				eventsWritten: written,
				eventsRemoved: removed,
			};
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			await this.state.markFailed(row.id, reason);
			return {
				source: "outlook_calendar",
				userId: row.userId,
				status: "failed",
				reason,
			};
		}
	}

	/**
	 * Resolve the calendar list action against the live catalogue — the same
	 * way the mail sync resolves "fetch" — and read the next window.
	 */
	async listEvents(userId: string): Promise<OutlookEvent[]> {
		for (const candidate of ACTION_CANDIDATES) {
			const result = await this.apps.executeAction(
				userId,
				"outlook",
				candidate,
				{
					start_datetime: new Date().toISOString(),
					end_datetime: this.horizon().toISOString(),
					top: 25,
				},
			);

			// The catalogue does not offer this handle; try the next candidate.
			if (result.outcome === "failed" && /does not offer/i.test(result.reason))
				continue;

			if (result.outcome === "failed") throw new Error(result.reason);

			return this.normalize(
				(result.output as { events?: unknown; value?: unknown })?.events ??
					(result.output as { value?: unknown })?.value ??
					result.output,
			);
		}

		throw new Error(
			"The connected Outlook app does not offer a calendar list action.",
		);
	}

	normalize(output: unknown): OutlookEvent[] {
		const rows = Array.isArray(output)
			? output
			: typeof output === "object" && output !== null && "value" in output
				? ((output as { value: unknown }).value as unknown[])
				: [];

		const events: OutlookEvent[] = [];

		for (const raw of rows as RawOutlookEvent[]) {
			const id = typeof raw.id === "string" ? raw.id : null;
			const startsAt = this.time(raw.start);
			const endsAt = this.time(raw.end);
			if (!id || !startsAt || !endsAt) continue;

			const attendees: OutlookEvent["attendees"] = [];
			if (Array.isArray(raw.attendees)) {
				for (const attendee of raw.attendees as Record<string, unknown>[]) {
					const address =
						typeof (attendee.emailAddress ?? attendee.email) === "object" &&
						(attendee.emailAddress ?? attendee.email) !== null
							? ((
									(attendee.emailAddress ?? attendee.email) as Record<
										string,
										unknown
									>
								).address as string)
							: (attendee.email as string);
					if (typeof address !== "string" || address === "") continue;
					attendees.push({
						email: address.toLowerCase(),
						name:
							typeof attendee.name === "string"
								? attendee.name
								: ((attendee.emailAddress as { name?: string } | undefined)
										?.name ?? null),
					});
				}
			}

			events.push({
				id,
				subject: typeof raw.subject === "string" ? raw.subject : null,
				startsAt,
				endsAt,
				location:
					typeof raw.location === "string"
						? raw.location
						: ((raw.location as { displayName?: string } | undefined)
								?.displayName ?? null),
				description: typeof raw.body === "string" ? raw.body : null,
				organizer:
					typeof raw.organizer === "string"
						? raw.organizer
						: ((
								raw.organizer as
									| { emailAddress?: { address?: string } }
									| undefined
							)?.emailAddress?.address ?? null),
				cancelled: raw.isCancelled === true,
				attendees,
			});
		}

		return events;
	}

	private time(value: unknown): Date | null {
		if (typeof value === "object" && value !== null) {
			const parts = value as { dateTime?: string; timeZone?: string };
			if (!parts.dateTime) return null;
			// Graph omits the offset when the requested zone is UTC.
			value =
				parts.timeZone === "UTC" && !/(Z|[+-]\d\d:\d\d)$/.test(parts.dateTime)
					? `${parts.dateTime}Z`
					: parts.dateTime;
		}
		if (typeof value !== "string") return null;
		const at = new Date(value);
		return Number.isNaN(at.getTime()) ? null : at;
	}

	private async apply(
		event: OutlookEvent,
		row: MailboxSync,
		context: MatchContext,
	): Promise<"written" | "removed" | "ignored"> {
		const iCalUid = `outlook:${event.id}`;
		const originalStart = event.startsAt;

		if (event.cancelled) {
			const deleted = await this.db.calendarEvent.deleteMany({
				where: { iCalUid, originalStartTime: originalStart },
			});
			return deleted.count > 0 ? "removed" : "ignored";
		}

		const participants: Participant[] = [
			...event.attendees.map((attendee) => ({
				email: attendee.email,
				name: attendee.name,
			})),
			...(event.organizer
				? [{ email: event.organizer.toLowerCase(), name: null }]
				: []),
		].filter(
			(person) => person.email && !isMachineAddress(person.email),
		) as Participant[];

		const match = await this.match.resolve(
			{
				participants,
				allowCreate: row.autoCreate,
				source: RecordSource.CALENDAR,
				ownerId: row.userId,
			},
			context,
		);

		if (!match.companyId && !match.contactId) return "ignored";

		const record = await this.db.calendarEvent.upsert({
			where: {
				iCalUid_originalStartTime: {
					iCalUid,
					originalStartTime: originalStart,
				},
			},
			create: {
				iCalUid,
				originalStartTime: originalStart,
				title: event.subject,
				description: event.description,
				location: event.location,
				startsAt: event.startsAt,
				endsAt: event.endsAt,
				status: event.cancelled ? "cancelled" : "confirmed",
				organizerEmail: event.organizer,
				companyId: match.companyId,
				contactId: match.contactId,
				syncedByUserId: row.userId,
			},
			update: {
				title: event.subject,
				description: event.description,
				location: event.location,
				startsAt: event.startsAt,
				endsAt: event.endsAt,
				status: event.cancelled ? "cancelled" : "confirmed",
				organizerEmail: event.organizer,
				companyId: match.companyId,
				contactId: match.contactId,
			},
			select: { id: true },
		});

		await this.syncAttendees(record.id, event);
		await this.prepareForMeeting(record.id, event.startsAt);
		await this.project(record.id, row.userId, {
			title: event.subject ?? "Meeting",
			startsAt: event.startsAt,
			companyId: match.companyId,
			contactId: match.contactId,
			location: event.location,
		});

		return "written";
	}

	private async syncAttendees(
		eventId: string,
		event: OutlookEvent,
	): Promise<void> {
		const attendees = event.attendees.filter(
			(attendee) => !isMachineAddress(attendee.email),
		);
		if (attendees.length === 0) return;

		const emails = attendees.map((attendee) => attendee.email.toLowerCase());
		const contacts = await this.db.contact.findMany({
			where: { email: { in: emails } },
			select: { id: true, email: true },
		});
		const contactByEmail = new Map(
			contacts.map((contact) => [contact.email as string, contact.id]),
		);

		for (const attendee of attendees) {
			const email = attendee.email.toLowerCase();
			await this.db.calendarAttendee.upsert({
				where: { eventId_email: { eventId, email } },
				create: {
					eventId,
					email,
					name: attendee.name,
					responseStatus: null,
					isOrganizer: attendee.email === event.organizer,
					contactId: contactByEmail.get(email) ?? null,
				},
				update: {
					name: attendee.name,
					responseStatus: null,
					isOrganizer: attendee.email === event.organizer,
					contactId: contactByEmail.get(email) ?? null,
				},
			});
		}
	}

	private async prepareForMeeting(
		eventId: string,
		startsAt: Date,
	): Promise<void> {
		const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
		if (startsAt <= new Date() || startsAt > soon) return;

		const attendees = await this.db.calendarAttendee.findMany({
			where: {
				eventId,
				contactId: { not: null },
				contact: { brief: { is: null } },
			},
			select: { contactId: true },
		});

		for (const attendee of attendees) {
			if (attendee.contactId)
				await this.agent.meetingSoon(attendee.contactId, startsAt);
		}
	}

	private async project(
		calendarEventId: string,
		userId: string,
		summary: {
			title: string;
			startsAt: Date;
			companyId: string | null;
			contactId: string | null;
			location: string | null;
		},
	): Promise<void> {
		const body = summary.location ? `Location: ${summary.location}` : null;

		const activity = await this.db.activity.upsert({
			where: { calendarEventId },
			create: {
				type: ActivityType.MEETING,
				subject: summary.title,
				body,
				occurredAt: summary.startsAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
				createdById: userId,
				calendarEventId,
				meta: { synced: true, source: "outlook_calendar" },
			},
			update: {
				subject: summary.title,
				body,
				occurredAt: summary.startsAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
			},
			select: { createdAt: true },
		});

		await this.stamp.touch(
			{ companyId: summary.companyId, contactId: summary.contactId },
			activity.createdAt,
		);
	}

	private horizon(): Date {
		const to = new Date();
		to.setDate(to.getDate() + HORIZON_DAYS);
		return to;
	}
}
