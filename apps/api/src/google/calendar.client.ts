import {
	firstList,
	firstText,
	type JsonObject,
	type JsonValue,
	record,
	text,
} from "@crm/pramaan";
import { Injectable } from "@nestjs/common";
import type { MailboxResult } from "../mailbox/mailbox-api.client";
import { AppsConnectionService } from "../pramaan/apps-connection.service";

export type GoogleEvent = {
	id?: string;
	iCalUID?: string;
	status?: string;
	summary?: string;
	description?: string;
	location?: string;
	hangoutLink?: string;
	htmlLink?: string;
	recurringEventId?: string;
	start?: GoogleEventTime;
	end?: GoogleEventTime;
	originalStartTime?: GoogleEventTime;
	organizer?: { email?: string; displayName?: string; self?: boolean };
	creator?: { email?: string; displayName?: string; self?: boolean };
	attendees?: {
		email?: string;
		displayName?: string;
		responseStatus?: string;
		organizer?: boolean;
		self?: boolean;
		resource?: boolean;
	}[];
	conferenceData?: {
		entryPoints?: { entryPointType?: string; uri?: string }[];
	};
};

export type GoogleEventTime = {
	dateTime?: string;
	date?: string;
	timeZone?: string;
};

export type EventsPage = {
	items?: GoogleEvent[];
	nextPageToken?: string;
	nextSyncToken?: string;
};

export type EventsQuery = {
	syncToken?: string;
	timeMin?: string;
	timeMax?: string;
	pageToken?: string;
	maxResults?: number;
};

function eventFrom(raw: JsonObject): GoogleEvent | null {
	const id = firstText(raw, ["id", "eventId"]);
	if (!id) return null;

	const start = timeFrom(raw.start ?? raw.startTime ?? raw.begin);
	const end = timeFrom(raw.end ?? raw.endTime ?? raw.finish);

	const attendees = Array.isArray(raw.attendees)
		? raw.attendees.flatMap((entry) => {
				const email = firstText(entry, ["email", "address"]);
				if (!email) return [];
				return [
					{
						email,
						displayName: firstText(entry, ["displayName", "name"]),
						self: record(entry)?.self === true,
						resource: record(entry)?.resource === true,
						organizer: record(entry)?.organizer === true,
						responseStatus: firstText(entry, ["responseStatus", "rsvp"]),
					},
				];
			})
		: undefined;

	return {
		id,
		iCalUID: text(raw.iCalUID),
		status: text(raw.status),
		recurringEventId: text(raw.recurringEventId),
		originalStartTime: timeFrom(raw.originalStartTime),
		summary: firstText(raw, ["summary", "title"]),
		description: text(raw.description),
		location: text(raw.location),
		hangoutLink: firstText(raw, ["hangoutLink", "videoLink", "meetingLink"]),
		start,
		end,
		organizer: addressRole(raw.organizer ?? raw.creator),
		creator: addressRole(raw.creator),
		attendees,
	};
}

function addressRole(
	source: JsonValue,
): { email?: string; displayName?: string; self?: boolean } | undefined {
	const direct = text(source);
	if (direct) return { email: direct };
	const email = firstText(source, ["email", "address"]);
	if (!email) return undefined;
	return {
		email,
		displayName: firstText(source, ["name", "displayName"]),
	};
}

function timeFrom(source: JsonValue): GoogleEventTime | undefined {
	const direct = text(source);
	if (direct) return { dateTime: direct };
	const dateTime = firstText(source, ["dateTime", "at"]);
	if (dateTime) return { dateTime };
	const date = firstText(source, ["date"]);
	return date ? { date } : undefined;
}

/**
 * Reads the rep's primary calendar through their Pramaan connection; `accessToken`
 * carries their end-user reference. Sync tokens become plain time windows.
 */
@Injectable()
export class CalendarClient {
	constructor(private readonly apps: AppsConnectionService) {}

	async listEvents(
		accessToken: string,
		query: EventsQuery,
	): Promise<MailboxResult<EventsPage>> {
		const result = await this.apps.executeAction(
			accessToken,
			"googlecalendar",
			"events_list",
			{
				calendarId: "primary",
				timeMin: query.timeMin,
				timeMax: query.timeMax,
				maxResults: query.maxResults ?? 25,
				singleEvents: true,
				pageToken: query.pageToken,
				fields:
					"items(id,iCalUID,status,summary,description,location,start,end,originalStartTime,recurringEventId,organizer,attendees,hangoutLink),nextPageToken",
			},
		);

		if (result.outcome !== "ok") {
			return {
				outcome: "failed",
				reason: result.reason,
				retryable: result.retryable,
			};
		}

		const rows = firstList(result.output, ["items", "events"]);

		const items = rows.flatMap((row) => {
			const fields = record(row);
			const event = fields ? eventFrom(fields) : null;
			return event ? [event] : [];
		});

		return {
			outcome: "ok",
			data: {
				items,
				nextPageToken: firstText(result.output, ["nextPageToken"]),
				// Actions have no sync token; the next pass re-reads the window.
				nextSyncToken: query.syncToken,
			},
		};
	}
}

export function conferenceUrl(event: GoogleEvent): string | null {
	if (event.hangoutLink) return event.hangoutLink;

	const entry = event.conferenceData?.entryPoints?.find(
		(point) => point.entryPointType === "video" && point.uri,
	);

	return entry?.uri ?? null;
}

export function eventTime(
	time: GoogleEventTime | undefined,
): { at: Date; isAllDay: boolean } | null {
	if (time?.dateTime) {
		const at = new Date(time.dateTime);
		return Number.isNaN(at.getTime()) ? null : { at, isAllDay: false };
	}

	if (time?.date) {
		const at = new Date(`${time.date}T00:00:00Z`);
		return Number.isNaN(at.getTime()) ? null : { at, isAllDay: true };
	}

	return null;
}
