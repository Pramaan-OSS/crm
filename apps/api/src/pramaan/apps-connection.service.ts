// The workspace's connected apps — mail and calendar — live behind Pramaan. A rep connects
// their mailbox once through a hosted sign-in link; after that, data is read by running
// actions as that connection. This module is the API's only doorway to that machinery.

import { type Db } from "@crm/db";
import {
	type Caps,
	idempotencyKey,
	type JsonObject,
	type JsonValue,
	type Pramaan,
} from "@crm/pramaan";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import { InjectPramaan, PRAMAAN } from "./pramaan.constants";

export const APP_GMAIL = "gmail";
// Pramaan's app slugs, as apps.connection.start and apps.connections.list name them.
export const APP_GOOGLE_CALENDAR = "googlecalendar";
export const APP_OUTLOOK = "outlook";

export type AppsConnectionStatus = "active" | "pending" | "failed" | "none";

const LIST_CACHE_MS = 60_000;

const CATALOG_CACHE_MS = 24 * 60 * 60_000;

@Injectable()
export class AppsConnectionService {
	private readonly logger = new Logger(AppsConnectionService.name);

	// Per rep: one rep's connections must never answer for another's.
	private readonly listCache = new Map<
		string,
		{ at: number; rows: Map<string, AppsConnectionStatus> }
	>();

	private readonly catalogPages = new Map<
		string,
		{ at: number; page: Promise<Caps.AppsCatalogSearchResult> }
	>();
	private readonly discovered = new Map<string, Set<string>>();

	constructor(
		@Optional()
		@Inject(PRAMAAN)
		private readonly api: Pramaan | null,
		@InjectDatabase() private readonly db: Db,
	) {}

	/** The mailbox address behind `crm-<userId>`: the rep's own sign-in email. */
	async emailForRef(endUserRef: string): Promise<string | null> {
		const userId = endUserRef.startsWith("crm-") ? endUserRef.slice(4) : null;
		if (!userId) return null;

		const user = await this.db.user.findUnique({
			where: { id: userId },
			select: { email: true },
		});

		return user?.email ?? null;
	}

	configured(): boolean {
		return this.api !== null;
	}

	/**
	 * A stable, non-identifying reference for one rep across their connected apps. Never an
	 * email or a name.
	 */
	endUserRef(userId: string): string {
		return `crm-${userId}`;
	}

	async statusFor(userId: string, app: string): Promise<AppsConnectionStatus> {
		const rows = await this.listStatuses(userId);
		return rows.get(app) ?? "none";
	}

	async listStatuses(
		userId: string,
		apps?: readonly string[],
	): Promise<Map<string, AppsConnectionStatus>> {
		if (!this.api) return new Map();

		const now = Date.now();
		const cached = this.listCache.get(userId);
		if (cached && now - cached.at < LIST_CACHE_MS) {
			return this.filterCached(cached.rows, apps);
		}

		try {
			const response = await this.api.appsConnectionsList({
				endUserRef: this.endUserRef(userId),
			});

			const rows = new Map<string, AppsConnectionStatus>();
			for (const row of response.results) {
				rows.set(
					row.app,
					row.status === "active"
						? "active"
						: row.status === "pending"
							? "pending"
							: "failed",
				);
			}

			this.listCache.set(userId, { at: now, rows });
			return this.filterCached(rows, apps);
		} catch (error) {
			this.logger.warn({
				message: "Could not read the connected apps",
				reason: error instanceof Error ? error.message : String(error),
			});
			return new Map();
		}
	}

	/** Begin connecting an app: the hosted sign-in link to send the rep to. */
	async startConnect(
		userId: string,
		app: string,
		redirectUrl: string,
	): Promise<{ connectUrl: string } | { error: string }> {
		if (!this.api) {
			return {
				error: "Pramaan is not configured, so apps cannot be connected.",
			};
		}

		try {
			const response = await this.api.appsConnectionStart(
				{ endUserRef: this.endUserRef(userId), app, redirectUrl },
				{ idempotencyKey: idempotencyKey() },
			);
			this.listCache.delete(userId);
			return { connectUrl: response.connectUrl };
		} catch (error) {
			return {
				error:
					error instanceof Error
						? error.message
						: "Could not start the connection.",
			};
		}
	}

	async revoke(userId: string, app: string): Promise<void> {
		if (!this.api) return;

		try {
			await this.api.appsConnectionRevoke(
				{ endUserRef: this.endUserRef(userId), app },
				{ idempotencyKey: idempotencyKey() },
			);
		} finally {
			this.listCache.delete(userId);
		}
	}

	/**
	 * Run one action as this rep's connection. The action id is resolved against the live
	 * catalogue rather than hard-coded, so the wiring holds as actions are renamed.
	 */
	async executeAction(
		userId: string,
		toolkit: string,
		action: string,
		input: JsonObject = {},
	): Promise<
		| { outcome: "ok"; output: JsonValue }
		| { outcome: "failed"; reason: string; retryable: boolean }
	> {
		if (!this.api) {
			return {
				outcome: "failed",
				reason: "Pramaan is not configured.",
				retryable: false,
			};
		}

		const handle = await this.actionHandle(userId, toolkit, action);
		if (!handle) {
			return {
				outcome: "failed",
				reason: `The connected app does not offer a "${action}" action.`,
				retryable: false,
			};
		}

		try {
			const response = await this.api.appsActionExecute(
				{
					// Mail readers already carry the connected end-user reference.
					endUserRef: userId.startsWith("crm-")
						? userId
						: this.endUserRef(userId),
					action: handle,
					input,
				},
				{ idempotencyKey: idempotencyKey() },
			);

			if (response.status !== "succeeded") {
				return {
					outcome: "failed",
					reason: response.error ?? "The connected app refused the request.",
					retryable: false,
				};
			}

			return { outcome: "ok", output: response.output };
		} catch (error) {
			return {
				outcome: "failed",
				reason: error instanceof Error ? error.message : String(error),
				retryable: false,
			};
		}
	}

	/** Use history only when the catalogue supplies a read-only action and usable fields. */
	async gmailHistory(
		userId: string,
		startHistoryId: string,
		pageToken?: string,
	): Promise<JsonValue | null> {
		if (!this.api || !/^\d+$/.test(startHistoryId)) return null;
		try {
			const page = await this.discoverActions(`sync:${userId}`, {
				query: "GMAIL_LIST_HISTORY",
				app: "gmail",
			});
			const action = page.results.find(
				(row) =>
					row.app.toLowerCase() === "gmail" &&
					row.action === "GMAIL_LIST_HISTORY" &&
					row.readOnly === true,
			);
			if (!action?.inputSchema || typeof action.inputSchema !== "object")
				return null;
			const schema = action.inputSchema as {
				properties?: Record<string, unknown>;
			};
			const properties = schema.properties ?? {};
			const start = ["startHistoryId", "start_history_id"].find(
				(key) => key in properties,
			);
			const token = ["pageToken", "page_token"].find(
				(key) => key in properties,
			);
			if (!start || (pageToken && !token)) return null;
			const input = {
				[start]: startHistoryId,
				...(pageToken && token ? { [token]: pageToken } : {}),
			};
			// Do not guess required account fields or send catalogue defaults/samples.
			const validated = z
				.fromJSONSchema(action.inputSchema as z.core.JSONSchema.JSONSchema)
				.safeParse(input);
			if (!validated.success) return null;
			const result = await this.executeAction(
				userId,
				"gmail",
				action.action,
				input,
			);
			return result.outcome === "ok" ? result.output : null;
		} catch {
			return null;
		}
	}

	/** One paid page on explicit demand, scoped to the caller's authenticated session. */
	async discoverActions(
		session: string,
		input: Caps.AppsCatalogSearchRequest,
	): Promise<Caps.AppsCatalogSearchResult> {
		if (!this.api)
			throw new Error("Set a Pramaan key before discovering actions.");
		const key = JSON.stringify([
			session,
			input.query,
			input.app ?? "",
			input.limit ?? 10,
			input.cursor ?? "",
		]);
		const cached = this.catalogPages.get(key);
		if (cached && Date.now() - cached.at < CATALOG_CACHE_MS) return cached.page;
		const page = this.api
			.appsCatalogSearch(input, { idempotencyKey: idempotencyKey() })
			.then((result) => {
				for (const row of result.results) {
					const app = row.app.toLowerCase();
					const handles = this.discovered.get(app) ?? new Set<string>();
					handles.add(row.action);
					this.discovered.set(app, handles);
				}
				return result;
			})
			.catch(() => {
				this.catalogPages.delete(key);
				throw new Error("Could not discover actions. Try later.");
			});
		if (this.catalogPages.size >= 500)
			this.catalogPages.delete(this.catalogPages.keys().next().value!);
		this.catalogPages.set(key, { at: Date.now(), page });
		return page;
	}

	/** Parse only the platform file handle returned by a successful download action. */
	async readDownloadedFile(
		output: JsonValue,
	): Promise<Caps.DocumentParseResult> {
		const fileId =
			output && typeof output === "object" && !Array.isArray(output)
				? output.fileId
				: null;
		if (typeof fileId !== "string" || !fileId)
			throw new Error("This action did not return a platform file handle.");
		if (!this.api)
			throw new Error("Set a Pramaan key before reading this file.");
		return this.api.documentParse({ fileId });
	}

	private async actionHandle(
		session: string,
		toolkit: string,
		action: string,
	): Promise<string | null> {
		const find = () =>
			[...(this.discovered.get(toolkit.toLowerCase()) ?? [])].find(
				(handle) =>
					handle.toLowerCase() === action.toLowerCase() ||
					handle.toLowerCase().includes(action.toLowerCase()),
			) ?? null;
		const cached = find();
		if (cached) return cached;

		// The catalogue pages alphabetically: walk pages until the wanted
		// handle shows up or the catalogue runs out.
		let cursor: string | undefined;
		for (let page = 0; page < 5; page += 1) {
			const result = await this.discoverActions(`sync:${session}`, {
				query: action,
				app: toolkit,
				limit: 50,
				...(cursor ? { cursor } : {}),
			});
			if (find()) return find();
			cursor = result.nextCursor;
			if (!cursor) break;
		}

		return null;
	}

	private filterCached(
		rows: Map<string, AppsConnectionStatus>,
		apps?: readonly string[],
	): Map<string, AppsConnectionStatus> {
		if (!apps) return rows;
		const out = new Map<string, AppsConnectionStatus>();
		for (const app of apps) {
			const status = rows.get(app);
			if (status) out.set(app, status);
		}
		return out;
	}
}

/** Resolves the mailbox address behind an end-user reference. */
@Injectable()
export class GmailUsers {
	constructor(private readonly apps: AppsConnectionService) {}

	async emailForRef(endUserRef: string): Promise<string | null> {
		return this.apps.emailForRef(endUserRef);
	}
}
