// @crm/pramaan — the one module through which every outside call in this product flows.
// Built from PRAMAAN_API_KEY and optional PRAMAAN_BASE_URL. Nothing else in the repository
// talks to an outside service.

import { randomUUID } from "node:crypto";
import type { Caps } from "./capabilities";
import { CATALOG } from "./catalog";
import { DEFAULT_BASE_URL, PramaanClient } from "./sdk/client";
import { PramaanError } from "./sdk/errors";
import type { RunOptions } from "./sdk/types";

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
export { type ErrorCode, PramaanError } from "./sdk/errors";
export type {
	CapabilityDescription,
	CapabilityInfo,
	CapabilitySummary,
	EffectClass,
	Estimate,
	Job,
	JobStatus,
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
	llmModelsList: "llm.models.list",
	storageObjectUploadUrl: "storage.object.upload-url",
	storageObjectDownloadUrl: "storage.object.download-url",
	appsConnectionStart: "apps.connection.start",
	appsConnectionsList: "apps.connections.list",
	appsConnectionRevoke: "apps.connection.revoke",
	appsActionExecute: "apps.action.execute",
	emailSend: "email.send",
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
	[Cap.llmModelsList]: {
		readonly req: Caps.LlmModelsListRequest;
		readonly res: Caps.LlmModelsListResult;
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
	[Cap.emailSend]: {
		readonly req: Caps.EmailSendRequest;
		readonly res: Caps.EmailSendResult;
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

	/** The untyped client, for capabilities not in CapShapes yet. */
	get raw(): PramaanClient {
		return this.client;
	}

	call<Id extends CapId>(
		id: Id,
		input: CapsCallInput<Id>,
		opts?: RunOptions,
	): Promise<CapsCallResult<Id>> {
		return this.client.call(id, input, opts) as Promise<CapsCallResult<Id>>;
	}

	run<Id extends CapId>(
		id: Id,
		input: CapsCallInput<Id>,
		opts?: RunOptions,
	): Promise<unknown> {
		return this.client.run(id, input, opts);
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
	llmModelsList(
		input: Caps.LlmModelsListRequest,
		opts?: RunOptions,
	): Promise<Caps.LlmModelsListResult> {
		return this.call(Cap.llmModelsList, input, opts);
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
	emailSend(
		input: Caps.EmailSendRequest,
		opts?: RunOptions,
	): Promise<Caps.EmailSendResult> {
		return this.call(Cap.emailSend, input, opts);
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
 */
export function pramaanFromEnv(env: {
	PRAMAAN_API_KEY?: string | undefined;
	PRAMAAN_BASE_URL?: string | undefined;
}): Pramaan | null {
	const apiKey = env.PRAMAAN_API_KEY?.trim();
	if (!apiKey) return null;
	return createPramaan({
		apiKey,
		baseUrl: env.PRAMAAN_BASE_URL?.trim() || undefined,
	});
}
