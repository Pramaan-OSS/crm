export { LOGO_MAX_BYTES, workspaceFileId, workspaceLogo } from "./logo-file";

// @crm/pramaan — the one module through which every outside call in this product flows.
// Built from PRAMAAN_API_KEY and optional PRAMAAN_BASE_URL. Nothing else in the repository
// talks to an outside service.

import { normalizeGenerationSchemas } from "./json-schema";

export { assertBoundedJsonSchema, normalizeJsonSchema } from "./json-schema";

import { randomUUID } from "node:crypto";
import type { Caps } from "./capabilities";
import { CATALOG } from "./catalog";
import { DEFAULT_BASE_URL, PramaanClient } from "./sdk/client";
import { PramaanError } from "./sdk/errors";
import type { LlmChatStreamEvent, RunOptions } from "./sdk/types";

export type { Caps } from "./capabilities";
export {
	firstList,
	firstText,
	type JsonObject,
	type JsonValue,
	list,
	record,
	text,
} from "./json";
export {
	DEFAULT_BASE_URL,
	PRAMAAN_API_URL,
	PramaanClient,
	type PramaanOptions,
} from "./sdk/client";
export { type ErrorCode, errorFromResponse, PramaanError } from "./sdk/errors";
export type {
	CapabilityDescription,
	CapabilityInfo,
	CapabilitySummary,
	EffectClass,
	Estimate,
	Job,
	JobStatus,
	LlmChatStreamEvent,
	OutcomeDescription,
	OutcomeEstimate,
	OutcomeRun,
	OutcomeRunOptions,
	OutcomeRunStep,
	OutcomeStep,
	OutcomeSummary,
	RunOptions,
	WaitOptions,
} from "./sdk/types";
export { CATALOG };

/** Capability ids this product calls, as a const so callers never mistype one. */
export const Cap = {
	webSearch: "web.search",
	webAnswers: "web.answers",
	webRead: "web.read",
	webExtract: "web.extract",
	webPageMetadata: "web.page.metadata",
	companiesEnrich: "companies.enrich",
	companiesNews: "companies.news",
	peopleEnrich: "people.enrich",
	peopleDevProfilesFind: "people.dev.profiles.find",
	peopleEmailVerify: "people.email.verify",
	exchangeRateGet: "finance.exchange-rate.get",
	llmComplete: "llm.complete",
	llmChat: "llm.chat",
	appsCatalogSearch: "apps.catalog.search",
	documentParse: "document.parse",
	storageObjectUploadUrl: "storage.object.upload-url",
	storageObjectDownloadUrl: "storage.object.download-url",
	appsConnectionStart: "apps.connection.start",
	appsConnectionsList: "apps.connections.list",
	appsConnectionRevoke: "apps.connection.revoke",
	appsActionExecute: "apps.action.execute",
	authSocialExchange: "auth.social.exchange",
	emailSend: "email.send",
	authBackendProvision: "auth.backend.provision",
	authBackendGet: "auth.backend.get",
	authBackendDomainsSet: "auth.backend.domains.set",
	authTokenVerify: "auth.token.verify",
	authUserGet: "auth.user.get",
	authUserDelete: "auth.user.delete",
	authUsersList: "auth.users.list",
	dbPostgresProvision: "db.postgres.provision",
	dbPostgresGet: "db.postgres.get",
} as const;

export type CapId = (typeof Cap)[keyof typeof Cap];

/** Request and result shape per capability id. */
interface CapShapes {
	[Cap.webSearch]: {
		readonly req: Caps.WebSearchRequest;
		readonly res: Caps.WebSearchResult;
	};
	[Cap.webAnswers]: {
		readonly req: Caps.WebAnswersRequest;
		readonly res: Caps.WebAnswersResult;
	};
	[Cap.webRead]: {
		readonly req: Caps.WebReadRequest;
		readonly res: Caps.WebReadResult;
	};
	[Cap.webExtract]: {
		readonly req: Caps.WebExtractRequest;
		readonly res: Caps.WebExtractResult;
	};
	[Cap.webPageMetadata]: {
		readonly req: Caps.WebPageMetadataRequest;
		readonly res: Caps.WebPageMetadataResult;
	};
	[Cap.companiesEnrich]: {
		readonly req: Caps.CompaniesEnrichRequest;
		readonly res: Caps.CompaniesEnrichResult;
	};
	[Cap.companiesNews]: {
		readonly req: Caps.CompaniesNewsRequest;
		readonly res: Caps.CompaniesNewsResult;
	};
	[Cap.peopleEnrich]: {
		readonly req: Caps.PeopleEnrichRequest;
		readonly res: Caps.PeopleEnrichResult;
	};
	[Cap.peopleDevProfilesFind]: {
		readonly req: Caps.PeopleDevProfilesRequest;
		readonly res: Caps.PeopleDevProfilesResult;
	};
	[Cap.peopleEmailVerify]: {
		readonly req: Caps.PeopleEmailVerifyRequest;
		readonly res: Caps.PeopleEmailVerifyResult;
	};
	[Cap.exchangeRateGet]: {
		readonly req: Caps.ExchangeRateRequest;
		readonly res: Caps.ExchangeRateResult;
	};
	[Cap.llmComplete]: {
		readonly req: Caps.LlmCompleteRequest;
		readonly res: Caps.LlmCompleteResult;
	};
	[Cap.llmChat]: {
		readonly req: Caps.LlmChatRequest;
		readonly res: Caps.LlmChatResult;
	};
	[Cap.appsCatalogSearch]: {
		readonly req: Caps.AppsCatalogSearchRequest;
		readonly res: Caps.AppsCatalogSearchResult;
	};
	[Cap.documentParse]: {
		readonly req: Caps.DocumentParseRequest;
		readonly res: Caps.DocumentParseResult;
	};
	[Cap.storageObjectUploadUrl]: {
		readonly req: Caps.StorageUploadUrlRequest;
		readonly res: Caps.StorageUploadUrlResult;
	};
	[Cap.storageObjectDownloadUrl]: {
		readonly req: Caps.StorageDownloadUrlRequest;
		readonly res: Caps.StorageDownloadUrlResult;
	};
	[Cap.appsConnectionStart]: {
		readonly req: Caps.AppsConnectionStartRequest;
		readonly res: Caps.AppsConnectionStartResult;
	};
	[Cap.appsConnectionsList]: {
		readonly req: Caps.AppsConnectionsListRequest;
		readonly res: Caps.AppsConnectionsListResult;
	};
	[Cap.appsConnectionRevoke]: {
		readonly req: Caps.AppsConnectionRevokeRequest;
		readonly res: Caps.AppsConnectionRevokeResult;
	};
	[Cap.appsActionExecute]: {
		readonly req: Caps.AppsActionExecuteRequest;
		readonly res: Caps.AppsActionExecuteResult;
	};
	[Cap.authSocialExchange]: {
		readonly req: Caps.AuthSocialExchangeRequest;
		readonly res: Caps.AuthSocialExchangeResult;
	};
	[Cap.emailSend]: {
		readonly req: Caps.EmailSendRequest;
		readonly res: Caps.EmailSendResult;
	};
	[Cap.authBackendProvision]: {
		readonly req: Record<string, never>;
		readonly res: Caps.AuthBackendProvisionResult;
	};
	[Cap.authBackendGet]: {
		readonly req: Record<string, never>;
		readonly res: Caps.AuthBackendGetResult;
	};
	[Cap.authBackendDomainsSet]: {
		readonly req: Caps.AuthBackendDomainsSetRequest;
		readonly res: Caps.AuthBackendDomainsSetResult;
	};
	[Cap.authTokenVerify]: {
		readonly req: Caps.AuthTokenVerifyRequest;
		readonly res: Caps.AuthTokenVerifyResult;
	};
	[Cap.authUserGet]: {
		readonly req: Caps.AuthUserGetRequest;
		readonly res: Caps.AuthUserGetResult;
	};
	[Cap.authUserDelete]: {
		readonly req: Caps.AuthUserDeleteRequest;
		readonly res: Caps.AuthUserDeleteResult;
	};
	[Cap.authUsersList]: {
		readonly req: Caps.AuthUsersListRequest;
		readonly res: Caps.AuthUsersListResult;
	};
	[Cap.dbPostgresProvision]: {
		readonly req: Record<string, never>;
		readonly res: Caps.DbPostgresProvisionResult;
	};
	[Cap.dbPostgresGet]: {
		readonly req: Record<string, never>;
		readonly res: Caps.DbPostgresGetResult;
	};
}

export type CapsCallInput<Id extends CapId> = CapShapes[Id]["req"];
export type CapsCallResult<Id extends CapId> = CapShapes[Id]["res"];

/**
 * A typed view over a client: each method is one capability, with its request and result
 * types. Tests can pass any object with the same `call` surface (see FakePramaan).
 */
export class Pramaan {
	constructor(private readonly client: PramaanClient) {}

	fileDownload(fileId: string): Promise<Response> {
		return this.client.fileDownload(fileId);
	}

	/** The untyped client, for capabilities not in CapShapes yet. */
	get raw(): PramaanClient {
		return this.client;
	}

	call<Id extends CapId>(
		id: Id,
		input: CapsCallInput<Id>,
		opts?: RunOptions,
	): Promise<CapsCallResult<Id>> {
		return this.client.call(
			id,
			id === Cap.llmChat || id === Cap.llmComplete
				? normalizeGenerationSchemas(input)
				: input,
			opts,
		) as Promise<CapsCallResult<Id>>;
	}

	run<Id extends CapId>(
		id: Id,
		input: CapsCallInput<Id>,
		opts?: RunOptions,
	): Promise<unknown> {
		return this.client.run(
			id,
			id === Cap.llmChat || id === Cap.llmComplete
				? normalizeGenerationSchemas(input)
				: input,
			opts,
		);
	}

	info(id: string) {
		return this.client.info(id);
	}

	get jobs() {
		return this.client.jobs;
	}

	get capabilities() {
		return this.client.capabilities;
	}

	/**
	 * Outcomes: fixed recipes of capability steps under one business name. Check
	 * `available` on the description at run time (it changes), estimate before a run
	 * that costs, and pass the estimate's `plan` when the outcome needs approval. A
	 * run of an unavailable outcome throws `upstream_unavailable` — the signal to use
	 * the capability path.
	 */
	get outcomes() {
		return this.client.outcomes;
	}

	/**
	 * Runs `llm.chat` and yields the reply as it is generated (PRA-10): text deltas,
	 * tool-call pieces, usage, then `done` with the checked result. A stream that ends
	 * early throws `upstream_unavailable` — what was generated is charged, so callers
	 * must not silently re-run the call. Streaming refused (a plain JSON reply on the
	 * same call) yields one `done` instead.
	 */
	llmChatStream(
		input: Caps.LlmChatRequest,
		opts?: RunOptions,
	): AsyncGenerator<LlmChatStreamEvent> {
		return this.client.llmChatStream(normalizeGenerationSchemas(input), opts);
	}

	// ── Typed helpers, one per capability the product uses ────────────────────

	webSearch(
		input: Caps.WebSearchRequest,
		opts?: RunOptions,
	): Promise<Caps.WebSearchResult> {
		return this.call(Cap.webSearch, input, opts);
	}
	webAnswers(
		input: Caps.WebAnswersRequest,
		opts?: RunOptions,
	): Promise<Caps.WebAnswersResult> {
		return this.call(Cap.webAnswers, input, opts);
	}
	webRead(
		input: Caps.WebReadRequest,
		opts?: RunOptions,
	): Promise<Caps.WebReadResult> {
		return this.call(Cap.webRead, input, opts);
	}
	webExtract(
		input: Caps.WebExtractRequest,
		opts?: RunOptions,
	): Promise<Caps.WebExtractResult> {
		return this.call(Cap.webExtract, input, opts);
	}
	webPageMetadata(
		input: Caps.WebPageMetadataRequest,
		opts?: RunOptions,
	): Promise<Caps.WebPageMetadataResult> {
		return this.call(Cap.webPageMetadata, input, opts);
	}
	companiesEnrich(
		input: Caps.CompaniesEnrichRequest,
		opts?: RunOptions,
	): Promise<Caps.CompaniesEnrichResult> {
		return this.call(Cap.companiesEnrich, input, opts);
	}
	companiesNews(
		input: Caps.CompaniesNewsRequest,
		opts?: RunOptions,
	): Promise<Caps.CompaniesNewsResult> {
		return this.call(Cap.companiesNews, input, opts);
	}
	peopleEnrich(
		input: Caps.PeopleEnrichRequest,
		opts?: RunOptions,
	): Promise<Caps.PeopleEnrichResult> {
		return this.call(Cap.peopleEnrich, input, opts);
	}
	peopleDevProfilesFind(
		input: Caps.PeopleDevProfilesRequest,
		opts?: RunOptions,
	): Promise<Caps.PeopleDevProfilesResult> {
		return this.call(Cap.peopleDevProfilesFind, input, opts);
	}
	peopleEmailVerify(
		input: Caps.PeopleEmailVerifyRequest,
		opts?: RunOptions,
	): Promise<Caps.PeopleEmailVerifyResult> {
		return this.call(Cap.peopleEmailVerify, input, opts);
	}
	exchangeRate(
		input: Caps.ExchangeRateRequest,
		opts?: RunOptions,
	): Promise<Caps.ExchangeRateResult> {
		return this.call(Cap.exchangeRateGet, input, opts);
	}
	llmComplete(
		input: Caps.LlmCompleteRequest,
		opts?: RunOptions,
	): Promise<Caps.LlmCompleteResult> {
		return this.call(Cap.llmComplete, input, opts);
	}
	llmChat(
		input: Caps.LlmChatRequest,
		opts?: RunOptions,
	): Promise<Caps.LlmChatResult> {
		return this.call(Cap.llmChat, input, opts);
	}
	appsCatalogSearch(
		input: Caps.AppsCatalogSearchRequest,
		opts?: RunOptions,
	): Promise<Caps.AppsCatalogSearchResult> {
		return this.call(Cap.appsCatalogSearch, input, opts);
	}
	documentParse(
		input: Caps.DocumentParseRequest,
		opts?: RunOptions,
	): Promise<Caps.DocumentParseResult> {
		return this.call(Cap.documentParse, input, opts);
	}
	storageUploadUrl(
		input: Caps.StorageUploadUrlRequest,
		opts?: RunOptions,
	): Promise<Caps.StorageUploadUrlResult> {
		return this.call(Cap.storageObjectUploadUrl, input, opts);
	}
	storageDownloadUrl(
		input: Caps.StorageDownloadUrlRequest,
		opts?: RunOptions,
	): Promise<Caps.StorageDownloadUrlResult> {
		return this.call(Cap.storageObjectDownloadUrl, input, opts);
	}
	appsConnectionStart(
		input: Caps.AppsConnectionStartRequest,
		opts?: RunOptions,
	): Promise<Caps.AppsConnectionStartResult> {
		return this.call(Cap.appsConnectionStart, input, opts);
	}
	appsConnectionsList(
		input: Caps.AppsConnectionsListRequest,
		opts?: RunOptions,
	): Promise<Caps.AppsConnectionsListResult> {
		return this.call(Cap.appsConnectionsList, input, opts);
	}
	appsConnectionRevoke(
		input: Caps.AppsConnectionRevokeRequest,
		opts?: RunOptions,
	): Promise<Caps.AppsConnectionRevokeResult> {
		return this.call(Cap.appsConnectionRevoke, input, opts);
	}
	appsActionExecute(
		input: Caps.AppsActionExecuteRequest,
		opts?: RunOptions,
	): Promise<Caps.AppsActionExecuteResult> {
		return this.call(Cap.appsActionExecute, input, opts);
	}
	authSocialExchange(
		input: Caps.AuthSocialExchangeRequest,
		opts?: RunOptions,
	): Promise<Caps.AuthSocialExchangeResult> {
		return this.call(Cap.authSocialExchange, input, opts);
	}
	emailSend(
		input: Caps.EmailSendRequest,
		opts?: RunOptions,
	): Promise<Caps.EmailSendResult> {
		return this.call(Cap.emailSend, input, opts);
	}

	/** Opens (or returns) the managed sign-in backend. Idempotent; safe to call every boot. */
	authBackendProvision(
		opts?: RunOptions,
	): Promise<Caps.AuthBackendProvisionResult> {
		return this.call(Cap.authBackendProvision, {} as never, opts);
	}
	authBackendGet(opts?: RunOptions): Promise<Caps.AuthBackendGetResult> {
		return this.call(Cap.authBackendGet, {} as never, opts);
	}
	authBackendDomainsSet(
		input: Caps.AuthBackendDomainsSetRequest,
		opts?: RunOptions,
	): Promise<Caps.AuthBackendDomainsSetResult> {
		return this.call(Cap.authBackendDomainsSet, input, opts);
	}
	authTokenVerify(
		input: Caps.AuthTokenVerifyRequest,
		opts?: RunOptions,
	): Promise<Caps.AuthTokenVerifyResult> {
		return this.call(Cap.authTokenVerify, input, opts);
	}
	authUserGet(
		input: Caps.AuthUserGetRequest,
		opts?: RunOptions,
	): Promise<Caps.AuthUserGetResult> {
		return this.call(Cap.authUserGet, input, opts);
	}
	authUserDelete(
		input: Caps.AuthUserDeleteRequest,
		opts?: RunOptions,
	): Promise<Caps.AuthUserDeleteResult> {
		return this.call(Cap.authUserDelete, input, opts);
	}
	authUsersList(
		input: Caps.AuthUsersListRequest,
		opts?: RunOptions,
	): Promise<Caps.AuthUsersListResult> {
		return this.call(Cap.authUsersList, input, opts);
	}
	/** Opens (or returns) the managed Postgres database. Idempotent; safe to call every boot. */
	dbPostgresProvision(
		opts?: RunOptions,
	): Promise<Caps.DbPostgresProvisionResult> {
		return this.call(Cap.dbPostgresProvision, {} as never, opts);
	}
	dbPostgresGet(opts?: RunOptions): Promise<Caps.DbPostgresGetResult> {
		return this.call(Cap.dbPostgresGet, {} as never, opts);
	}
}

/** A new key for an `external_*` call: the same key can never run the call twice. */
export function idempotencyKey(): string {
	return randomUUID();
}

/** Builds a client from explicit settings (env loaders pass theirs). */
export function createPramaan(options: {
	apiKey: string;
	baseUrl?: string;
	fetch?: (input: string, init: RequestInit) => Promise<Response>;
	sleep?: (ms: number) => Promise<void>;
}): Pramaan {
	return new Pramaan(
		new PramaanClient({
			apiKey: options.apiKey,
			baseUrl: options.baseUrl,
			fetch: options.fetch,
			sleep: options.sleep,
		}),
	);
}

/**
 * The product's client, from the environment. Null when no key is set: callers decide whether
 * that means a skipped feature or an error. Never log the key.
 *
 * With `PRAMAAN_FAKE=1` the client is the offline fake instead (empty routes: any
 * capability call fails loudly rather than reaching the network), so a fresh clone
 * can be smoke-tested with a dummy key. Tests construct `FakePramaan` directly and
 * never need this switch.
 */
/**
 * The one place `PRAMAAN_API_KEY` is read from the environment. Every consumer —
 * API, agent, auth, storage — gets its client (or its answer about whether one is
 * configured) from here, so the key is read in exactly one module.
 */
export function pramaanFromEnv(
	options: {
		fetch?: (input: string, init: RequestInit) => Promise<Response>;
	} = {},
): Pramaan | null {
	const apiKey = process.env.PRAMAAN_API_KEY?.trim();
	if (!apiKey) return null;
	if (process.env.PRAMAAN_FAKE?.trim() === "1") {
		// Offline fake: the app boots and renders; a capability call surfaces as a
		// plain failed call rather than reaching the network.
		return new Pramaan(
			new PramaanClient({
				apiKey: "fake",
				fetch: () =>
					Promise.reject(
						new Error("PRAMAAN_FAKE=1: network disabled for this run."),
					),
			}),
		);
	}
	return createPramaan({
		fetch: options.fetch,
		apiKey,
		baseUrl: process.env.PRAMAAN_BASE_URL?.trim() || undefined,
	});
}

/** True when a key is configured — the capability-style checks use this. */
export function pramaanKeySet(): boolean {
	return Boolean(process.env.PRAMAAN_API_KEY?.trim());
}

export {
	type OutcomeApproval,
	type OutcomeAttempt,
	runOutcomeFlow,
} from "./outcome-flow";
