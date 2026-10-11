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

	export interface LlmModelsListRequest {
		readonly limit?: number;
		readonly tier?: "fast" | "balanced" | "best";
		readonly cursor?: string;
	}

	export interface LlmModelsListResult {
		readonly results: ReadonlyArray<{
			readonly ref?: string;
			readonly tier?: "fast" | "balanced" | "best";
			readonly contextTokens: number;
			readonly maxOutputTokens?: number;
			readonly features: ReadonlyArray<
				"temperature" | "structured" | "tools" | "streaming"
			>;
		}>;
		readonly nextCursor?: string;
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
