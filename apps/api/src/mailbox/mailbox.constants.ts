import {
	CALENDAR_SCOPE,
	GMAIL_SCOPE,
	GOOGLE_PROVIDER_ID,
	type MailboxProviderId,
	MICROSOFT_PROVIDER_ID,
	OUTLOOK_MAIL_SCOPE,
} from "@crm/auth";
import {
	APP_GMAIL,
	APP_GOOGLE_CALENDAR,
	APP_OUTLOOK,
} from "../pramaan/apps-connection.service";

export {
	CALENDAR_SCOPE,
	GMAIL_SCOPE,
	GOOGLE_PROVIDER_ID,
	type MailboxProviderId,
	MICROSOFT_PROVIDER_ID,
	MICROSOFT_SYNC_SCOPES,
	OUTLOOK_MAIL_SCOPE,
	SYNC_SCOPES,
} from "@crm/auth";

export const SYNC_SOURCES = [
	"calendar",
	"gmail",
	"outlook",
	"outlook_calendar",
] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

export const GOOGLE_SYNC_SOURCES = ["calendar", "gmail"] as const;
export const MICROSOFT_SYNC_SOURCES = ["outlook", "outlook_calendar"] as const;

export type GoogleSyncSource = (typeof GOOGLE_SYNC_SOURCES)[number];
export type MicrosoftSyncSource = (typeof MICROSOFT_SYNC_SOURCES)[number];

export function isGoogleSyncSource(source: string): source is GoogleSyncSource {
	return (GOOGLE_SYNC_SOURCES as readonly string[]).includes(source);
}

export function isMicrosoftSyncSource(
	source: string,
): source is MicrosoftSyncSource {
	return (MICROSOFT_SYNC_SOURCES as readonly string[]).includes(source);
}

export const SCOPE_FOR_SOURCE = {
	calendar: CALENDAR_SCOPE,
	gmail: GMAIL_SCOPE,
	outlook: OUTLOOK_MAIL_SCOPE,
	outlook_calendar: OUTLOOK_MAIL_SCOPE,
} satisfies Record<SyncSource, string>;

export const PROVIDER_FOR_SOURCE = {
	calendar: GOOGLE_PROVIDER_ID,
	gmail: GOOGLE_PROVIDER_ID,
	outlook: MICROSOFT_PROVIDER_ID,
	outlook_calendar: MICROSOFT_PROVIDER_ID,
} satisfies Record<SyncSource, MailboxProviderId>;

/** The connected app behind each sync source. */
// One Pramaan connection covers both Outlook actions: mail and calendar.
export const APP_FOR_SOURCE = {
	calendar: APP_GOOGLE_CALENDAR,
	gmail: APP_GMAIL,
	outlook: APP_OUTLOOK,
	outlook_calendar: APP_OUTLOOK,
} satisfies Record<SyncSource, string>;
