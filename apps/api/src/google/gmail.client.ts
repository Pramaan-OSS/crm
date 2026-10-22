import { firstList, firstText, type JsonValue, record } from "@crm/pramaan";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { MailboxResult } from "../mailbox/mailbox-api.client";
import { AppsConnectionService } from "../pramaan/apps-connection.service";
import { type GmailPart, header } from "./gmail-mime";

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

const historyResponse = z.object({
	historyId: z.string().regex(/^\d+$/),
	history: z
		.array(
			z.object({
				id: z.string().optional(),
				messagesAdded: z
					.array(
						z.object({
							message: z.object({
								id: z.string().min(1),
								threadId: z.string().optional(),
							}),
						}),
					)
					.optional(),
			}),
		)
		.optional(),
	nextPageToken: z.string().optional(),
});

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
 * Incremental sync prefers the catalogued history action for native history cursors.
 * ISO cursors, unchecked fields, unavailable actions and paged history retain the
 * date-window polling path; `getMessage` fetches each added message.
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
			"GMAIL_FETCH_EMAILS",
			{
				// The list API returns newest messages first; IDs-only avoids a
				// slow detail fetch inside the platform's start window.
				query: `${WORK_MAIL_QUERY} after:${Math.floor(options.after.getTime() / 1000)} before:${Math.ceil(options.before.getTime() / 1000)}`,
				max_results: Math.min(options.maxResults ?? 5, 5),
				ids_only: true,
				verbose: false,
				include_payload: false,
				...(options.pageToken ? { page_token: options.pageToken } : {}),
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
			data: {
				messages: messageRefs(result.output),
				nextPageToken: firstText(result.output, ["nextPageToken"]),
			},
		};
	}

	async listHistory(
		accessToken: string,
		options: { startHistoryId: string; pageToken?: string },
	): Promise<MailboxResult<HistoryList>> {
		const output = await this.apps.gmailHistory(
			accessToken,
			options.startHistoryId,
			options.pageToken,
		);
		const history = historyResponse.safeParse(output);
		// The current sync does one read per tick. Keep polling if history needs more pages.
		if (history.success && !history.data.nextPageToken)
			return { outcome: "ok", data: history.data };
		const saved = pollingCursor(options.startHistoryId);
		const until = saved?.before ? new Date(saved.before) : new Date();
		const since = new Date(
			Math.max(
				(saved
					? new Date(saved.after)
					: cursorStart(options.startHistoryId)
				).getTime(),
				until.getTime() - 14 * 86400000,
			),
		);

		const listed = await this.listMessages(accessToken, {
			after: since,
			before: until,
			maxResults: 5,
			pageToken: saved?.pageToken,
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
				historyId: listed.data.nextPageToken
					? JSON.stringify({
							after: since.toISOString(),
							before: until.toISOString(),
							pageToken: listed.data.nextPageToken,
						})
					: cursorOf(until),
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
		const result = await this.apps.executeAction(
			accessToken,
			"gmail",
			"GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
			{
				message_id: id,
				format: "full",
			},
		);

		if (result.outcome !== "ok") {
			return {
				outcome: "failed",
				reason: result.reason,
				retryable: result.retryable,
			};
		}

		const raw = result.output;
		const native = record(raw);
		// Full detail responses already contain the MIME headers and encoded body.
		if (record(native?.payload)) {
			const payload = native?.payload as unknown as GmailPart;
			// Some action responses turn angle-bracket header values into display
			// names. The raw format keeps the original headers base64 encoded.
			if (
				!header(payload.headers, "from")?.includes("@") ||
				!header(payload.headers, "message-id")
			) {
				const rawResult = await this.apps.executeAction(
					accessToken,
					"gmail",
					"GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
					{ message_id: id, format: "raw" },
				);
				if (rawResult.outcome !== "ok")
					return {
						outcome: "failed",
						reason: rawResult.reason,
						retryable: rawResult.retryable,
					};
				const encoded = firstText(rawResult.output, ["raw"]);
				const headers = encoded ? rawHeaders(encoded) : [];
				if (
					!header(headers, "from")?.includes("@") ||
					!header(headers, "message-id")
				)
					return {
						outcome: "failed",
						reason:
							"The connected mailbox returned incomplete message headers.",
						retryable: false,
					};
				payload.headers = headers;
			}
			const timestamp = firstText(raw, ["messageTimestamp"]);
			return {
				outcome: "ok",
				data: {
					...(native as unknown as GmailMessage),
					id: firstText(raw, ["messageId", "id"]) ?? id,
					internalDate:
						firstText(raw, ["internalDate"]) ??
						(timestamp ? String(Date.parse(timestamp)) : undefined),
					payload,
				},
			};
		}

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
			{
				name: "Message-ID",
				value: firstText(raw, [
					"messageIdHeader",
					"internetMessageId",
					"message_id_header",
				]),
			},
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
	if (cursor.includes("T") && !Number.isNaN(parsed.getTime())) return parsed;
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

const pollingCursorSchema = z.object({
	after: z.iso.datetime(),
	before: z.iso.datetime(),
	pageToken: z.string().min(1),
});
function pollingCursor(cursor: string) {
	try {
		const parsed = pollingCursorSchema.safeParse(JSON.parse(cursor));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

function rawHeaders(encoded: string): { name: string; value: string }[] {
	const message = Buffer.from(encoded, "base64url").toString("utf8");
	const block = message.split(/\r?\n\r?\n/, 1)[0] ?? "";
	return block
		.replace(/\r?\n[ \t]+/g, " ")
		.split(/\r?\n/)
		.flatMap((line) => {
			const colon = line.indexOf(":");
			return colon > 0
				? [{ name: line.slice(0, colon), value: line.slice(colon + 1).trim() }]
				: [];
		});
}
