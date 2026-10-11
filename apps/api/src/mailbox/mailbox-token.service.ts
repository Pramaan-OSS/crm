import {
	IDENTITY_SCOPES,
	type MailboxProviderId,
	type SignInAccount,
} from "@crm/auth";
import { Injectable, Logger } from "@nestjs/common";
import { AppsConnectionService } from "../pramaan/apps-connection.service";
import {
	APP_FOR_SOURCE,
	SCOPE_FOR_SOURCE,
	SYNC_SOURCES,
	type SyncSource,
} from "./mailbox.constants";

export type TokenFailure =
	| { outcome: "needs-reconnect"; reason: string }
	| { outcome: "not-connected"; reason: string };

export type TokenResult = { outcome: "ok"; accessToken: string } | TokenFailure;

/**
 * The credential a sync runs with is the rep's Pramaan connection — their end-user
 * reference — not a vendor token. Everything the connection grants is checked here, once.
 */
@Injectable()
export class MailboxTokenService {
	private readonly logger = new Logger(MailboxTokenService.name);

	constructor(private readonly apps: AppsConnectionService) {}

	/**
	 * The scopes a caller can see are the connected sources, expressed in the old scope
	 * vocabulary so the connection screens keep reading the same. Sign-in itself only ever
	 * holds IDENTITY_SCOPES.
	 */
	async grantedScopes(
		userId: string,
		_providerId: MailboxProviderId,
	): Promise<Set<string>> {
		const granted = new Set<string>(IDENTITY_SCOPES);

		const statuses = await this.apps.listStatuses(
			userId,
			SYNC_SOURCES.map((source) => APP_FOR_SOURCE[source]),
		);

		for (const source of SYNC_SOURCES) {
			if (statuses.get(APP_FOR_SOURCE[source]) === "active") {
				granted.add(SCOPE_FOR_SOURCE[source]);
			}
		}

		return granted;
	}

	async isConnected(userId: string, source: SyncSource): Promise<boolean> {
		return (
			(await this.apps.statusFor(userId, APP_FOR_SOURCE[source])) === "active"
		);
	}

	async signInAccounts(userId: string): Promise<SignInAccount[]> {
		const statuses = await this.apps.listStatuses(
			userId,
			SYNC_SOURCES.map((source) => APP_FOR_SOURCE[source]),
		);

		// The rows the connection screens read: which mailbox apps are connected.
		return [...statuses.entries()].map(([app, status]) => ({
			providerId: app,
			scope: status === "active" ? "connected" : null,
		}));
	}

	async hasRefreshToken(
		userId: string,
		providerId: MailboxProviderId,
	): Promise<boolean> {
		return this.isConnected(
			userId,
			providerId === "google" ? "gmail" : "outlook",
		);
	}

	async accessTokenFor(
		userId: string,
		source: SyncSource,
	): Promise<TokenResult> {
		const status = await this.apps.statusFor(userId, APP_FOR_SOURCE[source]);

		if (status === "active") {
			return { outcome: "ok", accessToken: this.apps.endUserRef(userId) };
		}

		if (status === "pending") {
			return {
				outcome: "not-connected",
				reason: `The ${source} connection has not been finished yet.`,
			};
		}

		if (status === "failed") {
			return {
				outcome: "needs-reconnect",
				reason: `The ${source} connection failed. Connect it again.`,
			};
		}

		return {
			outcome: "not-connected",
			reason: `The ${source} app is not connected.`,
		};
	}

	async revoke(
		userId: string,
		providerId: MailboxProviderId,
	): Promise<boolean> {
		const apps =
			providerId === "google" ? ["gmail", "google_calendar"] : ["outlook"];

		let revokedAny = false;
		for (const app of apps) {
			try {
				await this.apps.revoke(userId, app);
				revokedAny = true;
			} catch (error) {
				this.logger.warn({
					message: "Connected app revoke failed",
					userId,
					app,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return revokedAny;
	}
}
