// The Pramaan client. `fetch` only, no Node built-ins, so it runs in Node, Next.js, Bun and
// Workers. Vendored from @pramaan/sdk; the generated per-capability catalog and sugar are
// replaced by this product's own mini-catalog and typed helpers (see ../capabilities.ts).

import { capabilityInfo } from "../catalog";
import { errorFromResponse, PramaanError } from "./errors";
import type {
	CapabilityDescription,
	CapabilityInfo,
	CapabilitySummary,
	ErrorCode,
	Estimate,
	Job,
	JobStatus,
	RunOptions,
	WaitOptions,
} from "./types";

/**
 * The hosted API's URL: the one place the API domain is set.
 */
export const PRAMAAN_API_URL = "https://api.pramaan.dev";
export const DEFAULT_BASE_URL = PRAMAAN_API_URL;
export const MIN_POLL_MS = 2_000;
const MAX_POLL_MS = 30_000;
const DEFAULT_WAIT_MS = 31 * 60_000;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 8_000;

export interface PramaanOptions {
	readonly apiKey: string;
	/** Default: the hosted API. Point elsewhere for a dev or test API. */
	readonly baseUrl?: string;
	/** Retries for `read_only` calls on 429/5xx/network errors. Default 2. */
	readonly maxRetries?: number;
	/** Custom fetch (tests, proxies). Default: the global fetch. */
	readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
	/** Custom sleep (tests). Default: setTimeout. */
	readonly sleep?: (ms: number) => Promise<void>;
}

interface ApiResponse {
	readonly status: number;
	readonly body: unknown;
}

type Started = { readonly job: Job } | { readonly result: unknown };

const JOB_STATUSES: ReadonlySet<string> = new Set<JobStatus>([
	"running",
	"done",
	"failed",
	"cancelled",
]);

/** A bulk run's progress, when the API sent one with whole numbers in it. */
function progressOf(value: unknown): Pick<Job, "progress"> | undefined {
	const { total, done } = (value ?? {}) as { total?: unknown; done?: unknown };
	return Number.isInteger(total) && Number.isInteger(done)
		? { progress: { total: total as number, done: done as number } }
		: undefined;
}

function toJob(body: unknown, capability: string): Job {
	const raw = (body ?? {}) as Record<string, unknown>;
	const status = String(raw.status);
	if (typeof raw.job_id !== "string" || !JOB_STATUSES.has(status)) {
		throw new PramaanError(
			"internal",
			"The API returned an unexpected job shape.",
		);
	}
	const error = raw.error as { code?: unknown; message?: unknown } | undefined;
	return {
		id: raw.job_id,
		capability:
			typeof raw.capability === "string" ? raw.capability : capability,
		status: status as JobStatus,
		...("result" in raw ? { result: raw.result } : {}),
		...(progressOf(raw.progress) ?? {}),
		...(error
			? {
					error: {
						code: String(error.code) as ErrorCode,
						message: String(error.message),
					},
				}
			: {}),
		...(typeof raw.created_at === "string"
			? { createdAt: raw.created_at }
			: {}),
		...(typeof raw.updated_at === "string"
			? { updatedAt: raw.updated_at }
			: {}),
	};
}

function toSummary(raw: Record<string, unknown>): CapabilitySummary {
	return {
		id: String(raw.id),
		description: String(raw.description),
		effectClass: raw.effect_class as CapabilityInfo["effectClass"],
		mode: raw.mode === "async" ? "async" : "sync",
		needsConnection: raw.needs_connection === true,
		...(raw.requires_approval === true ? { requiresApproval: true } : {}),
		priceEstimateMicro: Number(raw.price_estimate_micro ?? 0),
	};
}

function toDescription(raw: Record<string, unknown>): CapabilityDescription {
	return {
		...toSummary(raw),
		example: raw.example,
		requestSchema: (raw.request_schema ?? {}) as Record<string, unknown>,
		resultSchema: (raw.result_schema ?? {}) as Record<string, unknown>,
	};
}

async function readBody(response: Response): Promise<unknown> {
	const text = await response.text();
	if (text === "") return undefined;
	try {
		return JSON.parse(text);
	} catch {
		throw new PramaanError(
			"internal",
			"The API returned a response that is not JSON.",
			{
				requestId: response.headers.get("x-request-id") ?? undefined,
				status: response.status,
			},
		);
	}
}

export class PramaanClient {
	readonly #apiKey: string;
	readonly #baseUrl: string;
	readonly #maxRetries: number;
	readonly #fetch: (input: string, init: RequestInit) => Promise<Response>;
	readonly #sleep: (ms: number) => Promise<void>;

	constructor(options: PramaanOptions) {
		if (!options?.apiKey) {
			throw new PramaanError(
				"unauthorized",
				"Pass apiKey to new PramaanClient().",
			);
		}
		this.#apiKey = options.apiKey;
		this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
		this.#maxRetries = options.maxRetries ?? 2;
		this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
		this.#sleep =
			options.sleep ??
			((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	}

	/** Sync capability: its result. Async capability: a running Job (see `jobs.wait`). */
	async run(
		id: string,
		input: unknown,
		opts: RunOptions = {},
	): Promise<unknown> {
		const started = await this.#start(id, input, opts);
		return "job" in started ? started.job : started.result;
	}

	/** Runs a capability and, when it is async, waits for the job to finish. */
	async call(
		id: string,
		input: unknown,
		opts: RunOptions = {},
	): Promise<unknown> {
		const started = await this.#start(id, input, opts);
		if (!("job" in started)) return started.result;
		const job = await this.jobs.wait(started.job.id);
		if (job.status === "done") return job.result;
		throw new PramaanError(
			job.error?.code ?? "internal",
			job.error?.message ?? `The job ended with status "${job.status}".`,
		);
	}

	/** Traits of one capability, from this product's mini-catalog. Sync and offline. */
	info(id: string): CapabilityInfo | undefined {
		return capabilityInfo(id);
	}

	readonly jobs = {
		get: async (id: string): Promise<Job> =>
			toJob(
				(
					await this.#request("GET", `/v1/jobs/${encodeURIComponent(id)}`, {
						retry: true,
					})
				).body,
				"",
			),

		/** Cancels a running job (no-op for a finished one). Never retried automatically. */
		cancel: async (id: string): Promise<Job> =>
			toJob(
				(
					await this.#request(
						"POST",
						`/v1/jobs/${encodeURIComponent(id)}/cancel`,
						{},
					)
				).body,
				"",
			),

		/**
		 * Polls until the job is no longer running (every 2 s or more, growing 1.5x to 30 s) and
		 * returns it, whatever the final status. Throws `upstream_timeout` when `timeoutMs` passes.
		 */
		wait: async (id: string, options: WaitOptions = {}): Promise<Job> => {
			const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_WAIT_MS);
			let interval = Math.max(MIN_POLL_MS, options.intervalMs ?? MIN_POLL_MS);
			for (;;) {
				const job = await this.jobs.get(id);
				if (job.status !== "running") return job;
				if (Date.now() + interval > deadline) {
					throw new PramaanError(
						"upstream_timeout",
						"The job is still running after timeoutMs.",
						{ retryable: true },
					);
				}
				await this.#sleep(interval);
				interval = Math.min(Math.ceil(interval * 1.5), MAX_POLL_MS);
			}
		},
	};

	readonly capabilities = {
		/** Every capability the API serves, with its price estimate. */
		list: async (): Promise<CapabilitySummary[]> => {
			const { body } = await this.#request("GET", "/v1/capabilities", {
				retry: true,
			});
			return (
				(body as { results?: Record<string, unknown>[] }).results ?? []
			).map(toSummary);
		},
		/** One capability with its request and result JSON Schema and an example. */
		get: async (id: string): Promise<CapabilityDescription> => {
			const { body } = await this.#request(
				"GET",
				`/v1/capabilities/${encodeURIComponent(id)}`,
				{ retry: true },
			);
			return toDescription(body as Record<string, unknown>);
		},
		/** What this request would cost at most, without running it. Nothing is charged. */
		estimate: async (
			id: string,
			input: unknown,
			opts: RunOptions = {},
		): Promise<Estimate> => {
			const { body } = await this.#request(
				"POST",
				`/v1/capabilities/${encodeURIComponent(id)}/estimate`,
				{ body: input ?? {}, headers: priceHeaders(opts), retry: true },
			);
			const raw = body as Record<string, unknown>;
			return {
				priceMaxMicro: Number(raw.price_max_micro ?? 0),
				balanceMicro: Number(raw.balance_micro ?? 0),
				canRun: raw.can_run === true,
				...(typeof raw.reason === "string"
					? { reason: raw.reason as NonNullable<Estimate["reason"]> }
					: {}),
			};
		},
	};

	async #start(id: string, input: unknown, opts: RunOptions): Promise<Started> {
		const response = await this.#request(
			"POST",
			`/v1/capabilities/${encodeURIComponent(id)}`,
			{
				body: input ?? {},
				...(opts.idempotencyKey !== undefined
					? { idempotencyKey: opts.idempotencyKey }
					: {}),
				headers: priceHeaders(opts),
				// Only read_only calls are retried; external_* (and unknown ids) never are.
				retry: this.info(id)?.effectClass === "read_only",
			},
		);
		return response.status === 202
			? { job: toJob(response.body, id) }
			: { result: response.body };
	}

	async #request(
		method: "GET" | "POST",
		path: string,
		options: {
			body?: unknown;
			idempotencyKey?: string;
			headers?: Record<string, string>;
			retry?: boolean;
		},
	): Promise<ApiResponse> {
		const headers: Record<string, string> = {
			...options.headers,
			Authorization: `Bearer ${this.#apiKey}`,
			Accept: "application/json",
		};
		if (options.body !== undefined)
			headers["Content-Type"] = "application/json";
		// The same key on every attempt, so a retry can never run the call twice.
		if (options.idempotencyKey !== undefined)
			headers["Idempotency-Key"] = options.idempotencyKey;
		const init: RequestInit = {
			method,
			headers,
			...(options.body !== undefined
				? { body: JSON.stringify(options.body) }
				: {}),
		};

		let previous: PramaanError | undefined;
		for (let attempt = 0; ; attempt++) {
			let error: PramaanError;
			let retryAfterMs: number | undefined;
			try {
				const response = await this.#fetch(`${this.#baseUrl}${path}`, init);
				if (response.ok) {
					return { status: response.status, body: await readBody(response) };
				}
				error = await errorFromResponse(response);
				const after = Number(response.headers.get("retry-after"));
				if (Number.isFinite(after) && after > 0) retryAfterMs = after * 1000;
			} catch (thrown) {
				if (thrown instanceof PramaanError) throw thrown;
				error = new PramaanError(
					"upstream_unavailable",
					"Could not reach the Pramaan API.",
					{
						retryable: true,
					},
				);
			}
			// A retry with the same Idempotency-Key can meet the first attempt's still-held
			// reservation (409, retryable). The first failure is the real answer, so report that.
			if (previous && error.code === "conflict" && error.retryable)
				throw previous;
			previous = error;
			const transient =
				error.status === undefined ||
				error.status === 429 ||
				error.status >= 500;
			if (!options.retry || !transient || attempt >= this.#maxRetries)
				throw error;
			await this.#sleep(
				retryAfterMs ??
					Math.min(
						RETRY_BASE_MS * 2 ** attempt + Math.random() * 100,
						RETRY_MAX_MS,
					),
			);
		}
	}
}

/** The per-call price limit and second-opinion options as request headers. */
function priceHeaders(opts: RunOptions): Record<string, string> {
	return {
		...(opts.maxPriceMicro !== undefined
			? { "Pramaan-Max-Price-Micro": String(opts.maxPriceMicro) }
			: {}),
		...(opts.secondOpinion ? { "Pramaan-Second-Opinion": "true" } : {}),
	};
}
