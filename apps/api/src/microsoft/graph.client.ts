import {
	firstList,
	firstText,
	type JsonValue,
	list,
	record,
	text,
} from "@crm/pramaan";
import { Injectable } from "@nestjs/common";
import { cursorStart } from "../google/gmail.client";
import type { MailboxResult } from "../mailbox/mailbox-api.client";
import { AppsConnectionService } from "../pramaan/apps-connection.service";

export type GraphAddress = {
	emailAddress?: { name?: string; address?: string };
};

export type GraphMessage = {
	id?: string;
	internetMessageId?: string;
	conversationId?: string;
	subject?: string | null;
	from?: GraphAddress;
	sender?: GraphAddress;
	toRecipients?: GraphAddress[];
	ccRecipients?: GraphAddress[];
	receivedDateTime?: string;
	sentDateTime?: string;
	body?: { contentType?: string; content?: string };
	bodyPreview?: string;
	internetMessageHeaders?: { name?: string; value?: string }[];
	parentFolderId?: string;
	webLink?: string;
};

export type MessagePage = {
	value?: GraphMessage[];
	"@odata.nextLink"?: string;
};

export type GraphUser = {
	mail?: string | null;
	userPrincipalName?: string | null;
};

export type GraphFolder = {
	id?: string;
};

function address(source: JsonValue): GraphAddress | undefined {
	const direct = text(source);
	if (direct) return { emailAddress: { address: direct } };
	const addressValue = firstText(source, ["address", "email"]);
	if (!addressValue) return undefined;
	return {
		emailAddress: {
			name: firstText(source, ["name"]),
			address: addressValue,
		},
	};
}

function addresses(source: JsonValue): GraphAddress[] | undefined {
	if (Array.isArray(source)) {
		const rows = list(source).flatMap((entry) => {
			const row = address(entry);
			return row ? [row] : [];
		});
		return rows.length > 0 ? rows : undefined;
	}
	const single = address(source);
	return single ? [single] : undefined;
}

/**
 * Reads Outlook through the rep's Pramaan connection; `accessToken` carries their
 * end-user reference. Message pages come from one action per window.
 */
@Injectable()
export class GraphClient {
	constructor(private readonly apps: AppsConnectionService) {}

	async me(accessToken: string): Promise<MailboxResult<GraphUser>> {
		const email = await this.apps.emailForRef(accessToken);
		if (!email) {
			return {
				outcome: "failed",
				reason: "No mailbox address on the connected account.",
				retryable: false,
			};
		}
		return { outcome: "ok", data: { mail: email, userPrincipalName: email } };
	}

	async folder(
		_accessToken: string,
		_wellKnownName: string,
	): Promise<MailboxResult<GraphFolder>> {
		// Actions read the inbox directly; a folder id is not needed.
		return { outcome: "ok", data: { id: "inbox" } };
	}

	async listMessages(
		accessToken: string,
		options: { after: Date; top: number },
	): Promise<MailboxResult<MessagePage>> {
		const result = await this.apps.executeAction(
			accessToken,
			"outlook",
			"fetch",
			{
				folder: "inbox",
				after: options.after.toISOString(),
				maxResults: options.top,
			},
		);

		if (result.outcome !== "ok") {
			return {
				outcome: "failed",
				reason: result.reason,
				retryable: result.retryable,
			};
		}

		const rows = firstList(result.output, ["value"]);

		const value = rows.flatMap((row) => {
			const fields = record(row);
			const id = firstText(fields, ["id", "messageId"]);
			if (!fields || !id) return [];

			const bodyContent = firstText(fields, [
				"bodyText",
				"body",
				"bodyPreview",
			]);

			return [
				{
					id,
					internetMessageId: text(fields.internetMessageId),
					conversationId: firstText(fields, ["conversationId", "threadId"]),
					subject: text(fields.subject) ?? null,
					from: address(fields.from ?? fields.sender),
					toRecipients: addresses(fields.to ?? fields.toRecipients),
					ccRecipients: addresses(fields.cc ?? fields.ccRecipients),
					receivedDateTime: firstText(fields, [
						"receivedDateTime",
						"date",
						"receivedAt",
					]),
					body: bodyContent
						? { contentType: "text", content: bodyContent }
						: undefined,
					bodyPreview: text(fields.bodyPreview),
				},
			];
		});

		return { outcome: "ok", data: { value } };
	}

	async nextPage(
		_accessToken: string,
		_nextLink: string,
	): Promise<MailboxResult<MessagePage>> {
		// One window, one page: the action result is the page.
		return { outcome: "ok", data: { value: [] } };
	}
}

export { cursorStart as outlookCursorStart };
