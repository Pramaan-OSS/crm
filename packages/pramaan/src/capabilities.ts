// Typed requests and results for the capabilities this product calls. Shapes follow the
// platform's capability contracts (generated from the catalogue's OpenAPI); only the fields
// this product uses are kept.

import type { JsonObject, JsonValue } from "./json";

export namespace Caps {
	// ── web ────────────────────────────────────────────────────────────────────

	export interface WebSearchRequest {
		readonly query: string;
		readonly limit?: number;
	}

	export interface WebSearchResult {
		readonly results: ReadonlyArray<{
			readonly title: string;
			readonly url: string;
			readonly snippet: string;
			readonly publishedAt?: string;
		}>;
	}

	export interface WebAnswersRequest {
		readonly task: string;
		readonly mode?: "fast" | "thorough";
		readonly jsonFormat?: JsonObject;
	}

	export interface WebAnswersResult {
		readonly answer: JsonValue;
		readonly sources: ReadonlyArray<{
			readonly title: string;
			readonly url: string;
		}>;
		readonly truncated: boolean;
	}

	export interface WebReadRequest {
		readonly url: string;
	}

	export interface WebReadResult {
		readonly url: string;
		readonly title: string;
		readonly text: string;
		readonly truncated: boolean;
	}

	export interface WebExtractRequest {
		readonly url: string;
		readonly schema?: JsonObject;
		readonly prompt?: string;
	}

	export interface WebExtractResult {
		readonly data: JsonValue;
		readonly url?: string;
		readonly title?: string;
		readonly truncated: boolean;
	}

	export interface WebPageMetadataRequest {
		readonly url: string;
	}

	export interface WebPageMetadataResult {
		readonly title: string;
		readonly description?: string;
		readonly ogImage?: unknown;
		readonly url?: string;
	}

	// ── companies ──────────────────────────────────────────────────────────────

	export interface CompaniesEnrichRequest {
		readonly domain?: string;
		readonly name?: string;
		readonly linkedinUrl?: string;
	}

	export interface CompaniesEnrichResult {
		readonly name: string;
		readonly domain?: string;
		readonly description?: string;
		readonly industry?: string;
		readonly employeeCount?: number;
		readonly foundedYear?: number;
		readonly location?: {
			readonly city?: string;
			readonly region?: string;
			readonly country?: string;
		};
		readonly websiteUrl?: string;
		readonly linkedinUrl?: string;
		readonly logoUrl?: string;
	}

	export interface CompaniesNewsRequest {
		readonly domain: string;
		readonly limit?: number;
	}

	export interface CompaniesNewsResult {
		readonly results: ReadonlyArray<{
			readonly title: string;
			readonly url: string;
			readonly source?: string;
			readonly publishedAt?: string;
			readonly summary?: string;
		}>;
		readonly nextCursor?: string;
	}

	// ── people ─────────────────────────────────────────────────────────────────

	export interface PeopleEnrichRequest {
		readonly email?: string;
		readonly linkedinUrl?: string;
		readonly domain?: string;
		readonly fullName?: string;
		readonly firstName?: string;
		readonly lastName?: string;
	}

	export interface PeopleEnrichResult {
		readonly fullName: string;
		readonly firstName?: string;
		readonly lastName?: string;
		readonly title?: string;
		readonly company?: { readonly name: string; readonly domain?: string };
		readonly location?: {
			readonly city?: string;
			readonly region?: string;
			readonly country?: string;
		};
		readonly linkedinUrl?: string;
	}

	export interface PeopleDevProfilesRequest {
		readonly linkedinUrl: string;
	}

	export interface PeopleDevProfilesResult {
		readonly profiles: ReadonlyArray<{
			readonly accountType?: string;
			readonly profileUrl?: unknown;
			readonly name?: string;
			readonly bio?: string;
			readonly company?: string;
			readonly location?: string;
			readonly followers?: number;
		}>;
		readonly truncated: boolean;
	}

	export interface PeopleEmailVerifyRequest {
		readonly email: string;
	}

	export interface PeopleEmailVerifyResult {
		readonly email: string;
		readonly deliverable: boolean;
		readonly status: "valid" | "invalid" | "accept_all" | "unknown";
		readonly risk?: "disposable" | "spam_trap" | "do_not_mail" | "other";
	}

	// ── finance ────────────────────────────────────────────────────────────────

	export interface ExchangeRateRequest {
		readonly from: string;
		readonly to: string;
	}

	export interface ExchangeRateResult {
		readonly rate?: number;
		readonly inverseRate: number;
		readonly date?: string;
	}

	// ── llm ────────────────────────────────────────────────────────────────────

	export interface LlmMessage {
		readonly role: "system" | "user" | "assistant";
		readonly content: string;
	}

	export interface LlmToolCall {
		/** Neutral call id from a prior turn; echoed unchanged with its result. */
		readonly id: string;
		readonly name: string;
		readonly arguments: Record<string, unknown>;
	}

	export type LlmChatMessage =
		| { readonly role: "system" | "user"; readonly content: string }
		| {
				readonly role: "assistant";
				readonly content?: string;
				readonly toolCalls?: ReadonlyArray<LlmToolCall>;
		  }
		| {
				readonly role: "tool";
				readonly toolCallId: string;
				readonly content: string;
		  };

	export interface LlmChatTool {
		readonly name: string;
		readonly description?: string;
		/** JSON Schema for the tool's arguments. */
		readonly parameters: Record<string, unknown>;
	}

	export interface LlmChatRequest {
		/** Conversation oldest first; every tool call answered exactly once before the next turn. */
		readonly messages: ReadonlyArray<LlmChatMessage>;
		readonly tools?: ReadonlyArray<LlmChatTool>;
		readonly model?: "fast" | "balanced" | "best";
		readonly maxTokens?: number;
		readonly temperature?: number;
		/** JSON Schema for structured output. */
		readonly jsonSchema?: Record<string, unknown>;
	}

	export interface LlmChatResult {
		readonly text?: string;
		readonly toolCalls: ReadonlyArray<LlmToolCall>;
		readonly finishReason: "stop" | "tool_calls" | "length" | "other";
		readonly usage: {
			readonly inputTokens: number;
			readonly outputTokens: number;
		};
	}

	export interface LlmCompleteRequest {
		readonly messages: ReadonlyArray<LlmMessage>;
		readonly model?: "fast" | "balanced" | "best";
		readonly maxTokens?: number;
		readonly temperature?: number;
	}

	export interface LlmCompleteResult {
		readonly text: string;
		readonly finishReason: "stop" | "length" | "other";
		readonly usage: {
			readonly inputTokens: number;
			readonly outputTokens: number;
		};
	}

	export interface AppsCatalogSearchRequest {
		readonly query: string;
		readonly app?: string;
		readonly cursor?: string;
		readonly limit?: number;
	}
	export interface AppsCatalogSearchResult {
		readonly results: ReadonlyArray<{
			readonly app: string;
			readonly action: string;
			readonly readOnly?: true;
			readonly description?: string;
			readonly inputSchema?: unknown;
		}>;
		readonly nextCursor?: string;
	}
	export interface DocumentParseRequest {
		readonly fileId: string;
		readonly ocr?: boolean;
	}
	export interface DocumentParseResult {
		readonly text: string;
		readonly truncated: boolean;
	}

	// ── storage ────────────────────────────────────────────────────────────────

	export interface StorageUploadUrlRequest {
		readonly bucket: string;
		readonly path: string;
		readonly overwrite?: boolean;
	}

	export interface StorageUploadUrlResult {
		readonly uploadUrl: string;
		readonly method: "PUT";
		readonly expiresAt?: string;
	}

	export interface StorageDownloadUrlRequest {
		readonly bucket: string;
		readonly path: string;
		readonly expiresIn?: number | null;
	}

	export interface StorageDownloadUrlResult {
		readonly downloadUrl: string;
		readonly expiresAt: string;
	}

	// ── apps (connected third-party apps) ──────────────────────────────────────

	export interface AppsConnectionStartRequest {
		readonly endUserRef: string;
		readonly app: string;
		readonly redirectUrl: string;
	}

	export interface AppsConnectionStartResult {
		readonly connectUrl: string;
		readonly expiresAt?: string;
	}

	export interface AppsConnectionsListRequest {
		readonly endUserRef: string;
		readonly app?: string;
	}

	export interface AppsConnectionsListResult {
		readonly results: ReadonlyArray<{
			readonly app: string;
			readonly status:
				| "active"
				| "pending"
				| "failed"
				| "expired"
				| "disabled"
				| "revoked";
			readonly connectedAt?: string;
		}>;
		readonly nextCursor?: string;
	}

	export interface AppsConnectionRevokeRequest {
		readonly endUserRef: string;
		readonly app: string;
	}

	export interface AppsConnectionRevokeResult {
		readonly revoked: number;
	}

	export interface AppsActionExecuteRequest {
		readonly endUserRef: string;
		readonly action: string;
		readonly input?: JsonObject;
	}

	export interface AppsActionExecuteResult {
		readonly status: "succeeded" | "failed";
		readonly output: JsonValue;
		readonly error?: string;
		readonly truncated?: true;
	}

	// ── auth ───────────────────────────────────────────────────────────────────

	export interface AuthSocialExchangeRequest {
		/** Sign-in product key, e.g. "google" or "microsoft". */
		readonly providerKey: string;
		/** Single-use authorization code returned to the app. */
		readonly code: string;
		/** Exact redirect URL used when requesting the code (https, or http on localhost). */
		readonly redirectUri: string;
		readonly pkceVerifier?: string;
		readonly expectedNonce?: string;
	}

	export interface AuthSocialExchangeResult {
		readonly providerKey: string;
		readonly subjectId: string;
		readonly email?: string;
		readonly emailVerified?: boolean;
		readonly displayName?: string;
		/** Short-lived picture link on platform file storage, when available. */
		readonly pictureUrl?: string;
	}

	/** Opens (or returns) the managed sign-in backend. No input, idempotent. */
	export interface AuthBackendProvisionResult {
		readonly status: "ready";
		/** Base URL of the managed sign-in backend; the sign-in client points here. */
		readonly authUrl: string;
		/** Public signing keys of the backend, for checking session tokens. */
		readonly jwksUrl: string;
	}

	export interface AuthBackendGetResult {
		readonly status: "ready" | "transferred";
		readonly authUrl: string;
		readonly jwksUrl: string;
		readonly socialProviders?: ReadonlyArray<{
			readonly provider: string;
			readonly credentials: "shared" | "own";
		}>;
		readonly allowedDomains?: ReadonlyArray<string>;
	}

	export interface AuthBackendDomainsSetRequest {
		/** The whole list of allowed return origins, up to 20; origins left out are removed. */
		readonly domains: ReadonlyArray<string>;
	}

	export interface AuthBackendDomainsSetResult {
		readonly domains: ReadonlyArray<{ readonly domain: string }>;
	}

	export interface AuthTokenVerifyRequest {
		/** The session token (a signed JWT) sent by the signed-in user's browser or app. */
		readonly token: string;
		readonly audience?: string;
		/** Allowed origins for the azp claim (the page that requested the token), 1 to 20. */
		readonly authorizedParties?: ReadonlyArray<string>;
	}

	export interface AuthTokenVerifyResult {
		/** True when the token is genuine, unexpired and passes the checks. */
		readonly valid: boolean;
		readonly userId?: string;
		readonly sessionId?: string;
		readonly orgId?: string;
		readonly expiresAt?: string;
	}

	export interface AuthUserGetRequest {
		readonly userId: string;
	}

	export interface AuthUserGetResult {
		readonly userId: string;
		readonly email?: string;
		readonly emailVerified?: boolean;
		readonly name?: string;
		readonly imageUrl?: string;
		readonly createdAt?: string;
		readonly lastSignInAt?: string;
		readonly banned?: boolean;
	}

	export interface AuthUsersListRequest {
		/** Matches email or name. */
		readonly query?: string;
		readonly limit?: number;
		readonly cursor?: string;
	}

	export interface AuthUsersListResult {
		readonly results: ReadonlyArray<{
			readonly userId: string;
			readonly email?: string;
			readonly emailVerified?: boolean;
			readonly name?: string;
			readonly imageUrl?: string;
			readonly createdAt?: string;
			readonly lastSignInAt?: string;
			readonly banned?: boolean;
		}>;
		readonly nextCursor?: string;
	}

	export interface AuthUserDeleteRequest {
		readonly userId: string;
		readonly confirm: true;
	}

	export interface AuthUserDeleteResult {
		readonly deleted: true;
	}

	// ── db.postgres ────────────────────────────────────────────────────────────

	export interface DbPostgresProvisionResult {
		readonly status: "ready" | "paused" | "transferred" | "held";
		/** True only when this call creates or restores the database and returns addresses. */
		readonly created: boolean;
		/** Pooled connection address; present only when created. Never log it. */
		readonly connectionString?: string;
		/** Direct connection address for migrations; present only when created. Never log it. */
		readonly directConnectionString?: string;
	}

	export interface DbPostgresGetResult {
		readonly status: "ready" | "paused" | "transferred" | "held";
	}

	// ── email ──────────────────────────────────────────────────────────────────

	export interface EmailSendRequest {
		readonly from: string;
		readonly to: string | ReadonlyArray<string>;
		readonly cc?: string | ReadonlyArray<string>;
		readonly bcc?: string | ReadonlyArray<string>;
		readonly replyTo?: string;
		readonly subject: string;
		readonly text?: string;
		readonly html?: string;
		readonly tags?: Record<string, string>;
	}

	export interface EmailSendResult {
		readonly status: "queued" | "sent";
		readonly ref?: string;
	}
}
