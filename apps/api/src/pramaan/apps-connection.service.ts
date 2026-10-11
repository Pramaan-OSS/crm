// The workspace's connected apps — mail and calendar — live behind Pramaan. A rep connects
// their mailbox once through a hosted sign-in link; after that, data is read by running
// actions as that connection. This module is the API's only doorway to that machinery.

import { type Db } from "@crm/db";
import {
	idempotencyKey,
	type JsonObject,
	type JsonValue,
	type Pramaan,
} from "@crm/pramaan";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { InjectPramaan, PRAMAAN } from "./pramaan.constants";

export const APP_GMAIL = "gmail";
export const APP_GOOGLE_CALENDAR = "google_calendar";
export const APP_OUTLOOK = "outlook";

export type AppsConnectionStatus = "active" | "pending" | "failed" | "none";

const LIST_CACHE_MS = 60_000;

const CATALOG_CACHE_MS = 10 * 60_000;

@Injectable()
export class AppsConnectionService {
	private readonly logger = new Logger(AppsConnectionService.name);

	private listCache: {
		at: number;
		rows: Map<string, AppsConnectionStatus>;
	} | null = null;

	private catalogCache: {
		at: number;
		actions: Map<string, string>;
	} | null = null;

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
		if (this.listCache && now - this.listCache.at < LIST_CACHE_MS) {
			return this.filterCached(this.listCache.rows, apps);
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

			this.listCache = { at: now, rows };
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
			const response = await this.api.appsConnectionStart({
				endUserRef: this.endUserRef(userId),
				app,
				redirectUrl,
			});
			this.listCache = null;
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
			this.listCache = null;
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

		const handle = await this.actionHandle(toolkit, action);
		if (!handle) {
			return {
				outcome: "failed",
				reason: `The connected app does not offer a "${action}" action.`,
				retryable: false,
			};
		}

		try {
			const response = await this.api.appsActionExecute({
				endUserRef: this.endUserRef(userId),
				action: handle,
				input,
			});

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

	/** The action's handle inside the catalogue, e.g. `GMAIL_FETCH_EMAILS`. */
	private async actionHandle(
		toolkit: string,
		action: string,
	): Promise<string | null> {
		const actions = await this.catalogue(toolkit);
		return actions.get(action) ?? null;
	}

	private async catalogue(toolkit: string): Promise<Map<string, string>> {
		const now = Date.now();
		if (this.catalogCache && now - this.catalogCache.at < CATALOG_CACHE_MS) {
			return this.prefix(this.catalogCache.actions, toolkit);
		}

		if (!this.api) return new Map();

		try {
			// apps.catalog.search is read through the raw client: it is platform
			// machinery, not one of the product's wrapped capabilities.
			const response = await this.api.raw
				.call("apps.catalog.search", { query: toolkit })
				.catch(() => null);

			const actions = new Map<string, string>();
			const results =
				(
					response as {
						results?: ReadonlyArray<{
							name?: string;
							toolkit?: string;
							handle?: string;
							slug?: string;
						}>;
					} | null
				)?.results ?? [];

			for (const row of results) {
				if (
					!row?.toolkit ||
					row.toolkit.toLowerCase() !== toolkit.toLowerCase()
				) {
					continue;
				}
				const handle = row.handle ?? row.slug;
				if (handle && row.name) actions.set(row.name, handle);
			}

			this.catalogCache = { at: now, actions };
			return this.prefix(actions, toolkit);
		} catch {
			return new Map();
		}
	}

	private prefix(
		rows: Map<string, string>,
		toolkit: string,
	): Map<string, string> {
		if (!toolkit) return rows;
		const out = new Map<string, string>();
		for (const [key, value] of rows) {
			if (key.toLowerCase().includes(toolkit.toLowerCase()))
				out.set(key, value);
		}
		return out;
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
