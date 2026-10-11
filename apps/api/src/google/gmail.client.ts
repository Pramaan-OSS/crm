import { firstList, firstText, type JsonValue } from "@crm/pramaan";
import { Injectable } from "@nestjs/common";
import type { MailboxResult } from "../mailbox/mailbox-api.client";
import { AppsConnectionService } from "../pramaan/apps-connection.service";
import type { GmailPart } from "./gmail-mime";

export type GmailMessage = {
	id?: string;
	threadId?: string;
	labelIds?: string[];
	snippet?: string;
	internalDate?: string;
	historyId?: string;
	payload?: GmailPart;
};

export type MessageList = {
	messages?: { id?: string; threadId?: string }[];
	nextPageToken?: string;
	resultSizeEstimate?: number;
};

export type HistoryList = {
	historyId?: string;
	history?: {
		id?: string;
		messagesAdded?: { message?: { id?: string; threadId?: string } }[];
	}[];
	nextPageToken?: string;
};

export type Profile = {
	emailAddress?: string;
	historyId?: string;
};

export const WORK_MAIL_QUERY =
	"-in:chats -category:promotions -category:social -category:forums";

/**
 * Reads Gmail through the rep's Pramaan connection: every read is one action run as their
 * connected account. The `accessToken` parameter carries the rep's end-user reference.
 *
 * Incremental sync is a date window: the cursor is an ISO timestamp, `listHistory` returns
 * the messages added since it, and `getMessage` fetches each one.
 */
@Injectable()
export class GmailClient {
	constructor(private readonly apps: AppsConnectionService) {}

	async profile(accessToken: string): Promise<MailboxResult<Profile>> {
		const email = await this.apps.emailForRef(accessToken);
		if (!email) {
			return {
				outcome: "failed",
				reason: "No mailbox address on the connected account.",
				retryable: false,
			};
		}

		return {
			outcome: "ok",
			data: { emailAddress: email, historyId: cursorOf(new Date()) },
		};
	}

	async listMessages(
		accessToken: string,
		options: {
			after: Date;
			before: Date;
			pageToken?: string;
			maxResults?: number;
		},
	): Promise<MailboxResult<MessageList>> {
		const result = await this.apps.executeAction(
			accessToken,
			"gmail",
			"fetch",
			{
				after: options.after.toISOString(),
				before: options.before.toISOString(),
				maxResults: options.maxResults ?? 100,
			},
		);

		if (result.outcome !== "ok") {
			return {
				outcome: "failed",
				reason: result.reason,
				retryable: result.retryable,
			};
		}

		return {
			outcome: "ok",
			data: { messages: messageRefs(result.output) },
		};
	}

	async listHistory(
		accessToken: string,
		options: { startHistoryId: string; pageToken?: string },
	): Promise<MailboxResult<HistoryList>> {
		const since = cursorStart(options.startHistoryId);
		const until = new Date();

		const listed = await this.listMessages(accessToken, {
			after: since,
			before: until,
			maxResults: 500,
		});

		if (listed.outcome !== "ok") {
			if (listed.outcome === "cursor-invalid") return listed;
			return {
				outcome: "failed",
				reason: listed.reason,
				retryable: listed.outcome === "failed" ? listed.retryable : false,
			};
		}

		return {
			outcome: "ok",
			data: {
				historyId: cursorOf(until),
				history: [
					{
						messagesAdded: (listed.data.messages ?? []).map((message) => ({
							message: { id: message.id, threadId: message.threadId },
						})),
					},
				],
			},
		};
	}

	async getMessage(
		accessToken: string,
		id: string,
	): Promise<MailboxResult<GmailMessage>> {
		const result = await this.apps.executeAction(accessToken, "gmail", "get", {
			messageId: id,
		});

		if (result.outcome !== "ok") {
			return {
				outcome: "failed",
				reason: result.reason,
				retryable: result.retryable,
			};
		}

		const raw = result.output;

		const subject = firstText(raw, ["subject", "Subject"]);
		const from = firstText(raw, ["from", "sender", "From"]);
		const to = firstText(raw, ["to", "To"]);
		const date = firstText(raw, ["date", "internalDate", "receivedAt", "Date"]);
		const body = firstText(raw, [
			"bodyText",
			"plainText",
			"text",
			"body",
			"bodyHtml",
			"html",
		]);

		const headers = [
			{ name: "Subject", value: subject },
			{ name: "From", value: from },
			{ name: "To", value: to },
			{ name: "Date", value: date },
		].filter((header) => header.value !== undefined);

		return {
			outcome: "ok",
			data: {
				id: firstText(raw, ["messageId", "id"]) ?? id,
				threadId: firstText(raw, ["threadId", "thread_id"]),
				snippet: firstText(raw, ["snippet", "preview", "bodyPreview"]),
				internalDate: date ? String(Date.parse(date) || "") : undefined,
				payload: {
					mimeType: "text/plain",
					headers,
					body: body
						? { data: Buffer.from(body).toString("base64url") }
						: undefined,
				},
			},
		};
	}
}

@Injectable()
export class GmailUsers {
	constructor(private readonly apps: AppsConnectionService) {}

	/** `crm-<userId>` -> the rep's sign-in email. */
	async emailForRef(endUserRef: string): Promise<string | null> {
		return this.apps.emailForRef(endUserRef);
	}
}

/** A cursor is just an ISO timestamp; any unknown value resumes from an hour ago. */
export function cursorOf(at: Date): string {
	return at.toISOString();
}

function cursorValue(cursor: string): Date {
	const parsed = new Date(cursor);
	if (!Number.isNaN(parsed.getTime())) return parsed;
	return new Date(Date.now() - 60 * 60 * 1000);
}

export function cursorStart(cursor: string): Date {
	return cursorValue(cursor);
}

function messageRefs(output: JsonValue): { id?: string; threadId?: string }[] {
	const rows = firstList(output, ["messages", "emails", "results"]);

	return rows.flatMap((row) => {
		const id = firstText(row, ["messageId", "id", "emailId"]);
		if (!id) return [];
		return [{ id, threadId: firstText(row, ["threadId", "thread_id"]) }];
	});
}
