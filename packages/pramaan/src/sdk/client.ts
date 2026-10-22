import type { PramaanOptions } from "@pramaan/sdk";
import { DEFAULT_BASE_URL, Pramaan as PublishedPramaan } from "@pramaan/sdk";
import { workspaceFileId, workspaceLogo } from "../logo-file";
// Compatibility helpers for product behavior absent from @pramaan/sdk 0.1.0.

import { capabilityInfo } from "../catalog";
import { errorFromResponse, PramaanError } from "./errors";
import type {
	CapabilityInfo,
	Job,
	LlmChatStreamEvent,
	OutcomeRun,
	OutcomeRunOptions,
	OutcomeRunStep,
	RunOptions,
	WaitOptions,
} from "./types";

/**
 * The hosted API's URL: the one place the API domain is set.
 */
export { DEFAULT_BASE_URL, PRAMAAN_API_URL } from "@pramaan/sdk";

export const MIN_POLL_MS = 2_000;
const MAX_POLL_MS = 30_000;
const DEFAULT_WAIT_MS = 31 * 60_000;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 8_000;

export type { PramaanOptions } from "@pramaan/sdk";

export class PramaanClient {
	readonly #sdkOptions: PramaanOptions;
	// Scope response metadata to one operation, including concurrent requests.
	async #usingSdk<T>(
		operation: (client: InstanceType<typeof PublishedPramaan>) => Promise<T>,
		opts?: RunOptions,
	): Promise<T> {
		let lastError: PramaanError | undefined;
		const client = new PublishedPramaan({
			...this.#sdkOptions,
			// Retries are controlled here: chat and outcome starts are never repeated.
			maxRetries: 0,
			fetch: async (url, init) => {
				const method = init.method ?? "GET";
				const path = new URL(url).pathname;
				const id = decodeURIComponent(path.split("/").pop() ?? "");
				const retry =
					method === "GET" ||
					path.endsWith("/estimate") ||
					(path.includes("/capabilities/") &&
						id !== "llm.chat" &&
						capabilityInfo(id)?.effectClass === "read_only");
				const headers = new Headers(init.headers);
				if (opts?.idempotencyKey === undefined)
					headers.delete("Idempotency-Key");
				if (opts?.fresh) headers.set("Pramaan-Fresh", "1");
				for (let attempt = 0; ; attempt++) {
					try {
						const response = await this.#fetch(url, { ...init, headers });
						if (response.ok) {
							lastError = undefined;
							return response;
						}
						const previous = lastError;
						lastError = await errorFromResponse(response.clone());
						if (
							previous &&
							lastError.code === "conflict" &&
							lastError.retryable
						) {
							lastError = previous;
							return response;
						}
						if (
							!retry ||
							(response.status !== 429 && response.status < 500) ||
							attempt >= this.#maxRetries
						)
							return response;
					} catch (error) {
						if (!retry || attempt >= this.#maxRetries) throw error;
					}
					await this.#sleep(
						lastError?.retryAfterMs ??
							Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS),
					);
				}
			},
		});
		try {
			return await operation(client);
		} catch (error) {
			throw lastError ?? error;
		}
	}

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
		this.#sdkOptions = options;
		this.#maxRetries = options.maxRetries ?? 2;
		this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
		this.#sleep =
			options.sleep ??
			((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	}

	/** Reads workspace metadata, then downloads its signed link without forwarding the key. */
	async fileDownload(fileId: string): Promise<Response> {
		workspaceFileId.parse(fileId);
		const base = (this.#sdkOptions.baseUrl ?? DEFAULT_BASE_URL).replace(
			/\/$/,
			"",
		);
		const metadata = await this.#fetch(`${base}/v1/files/${fileId}`, {
			headers: { Authorization: `Bearer ${this.#sdkOptions.apiKey}` },
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
		if (!metadata.ok) throw await errorFromResponse(metadata);
		const file = (await metadata.json()) as {
			fileId: string;
			contentType: string;
			sizeBytes: number;
			url: string;
		};
		workspaceLogo.parse({ ...file, size: file.sizeBytes });
		const link = new URL(file.url);
		if (
			file.fileId !== fileId ||
			link.origin !== new URL(base).origin ||
			link.pathname !== `/files/${fileId}` ||
			link.username ||
			link.password
		) {
			throw new PramaanError(
				"upstream_unavailable",
				"Invalid file download link.",
			);
		}
		return this.#fetch(link.toString(), {
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
	}

	/** Sync capability: its result. Async capability: a running Job (see `jobs.wait`). */
	async run(
		id: string,
		input: unknown,
		opts: RunOptions = {},
	): Promise<unknown> {
		return this.#usingSdk((client) => client.run(id, input, opts), opts);
	}

	async call(
		id: string,
		input: unknown,
		opts: RunOptions = {},
	): Promise<unknown> {
		return this.#usingSdk((client) => client.call(id, input, opts), opts);
	}

	/** Traits of one capability, from this product's mini-catalog. Sync and offline. */
	info(id: string): CapabilityInfo | undefined {
		return capabilityInfo(id);
	}

	readonly jobs = {
		get: (id: string): Promise<Job> =>
			this.#usingSdk((client) => client.jobs.get(id)),
		cancel: (id: string): Promise<Job> =>
			this.#usingSdk((client) => client.jobs.cancel(id)),

		/**
		 * Polls until the job is no longer running (every 2 s or more, growing 1.5x to 30 s) and
		 * returns it, whatever the final status. Throws `upstream_timeout` when `timeoutMs` passes.
		 */
		wait: async (id: string, options: WaitOptions = {}): Promise<Job> => {
			const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_WAIT_MS);
			let interval = Math.max(MIN_POLL_MS, options.intervalMs ?? MIN_POLL_MS);
			for (;;) {
				if (options.signal?.aborted) return this.jobs.cancel(id);
				const job = await this.jobs.get(id);
				if (job.status !== "running") return job;
				if (Date.now() + interval > deadline) {
					throw new PramaanError(
						"upstream_timeout",
						"The job is still running after timeoutMs.",
						{
							retryable: false,
							jobId: id,
						},
					);
				}
				if (options.signal) {
					const signal = options.signal;
					let wake: () => void = () => {};
					const aborted = new Promise<void>((resolve) => {
						wake = resolve;
						signal.addEventListener("abort", wake, { once: true });
					});
					try {
						if (!signal.aborted)
							await Promise.race([this.#sleep(interval), aborted]);
					} finally {
						signal.removeEventListener("abort", wake);
					}
				} else await this.#sleep(interval);
				interval = Math.min(Math.ceil(interval * 1.5), MAX_POLL_MS);
			}
		},
	};

	readonly capabilities = {
		list: () => this.#usingSdk((client) => client.capabilities.list()),
		get: (id: string) =>
			this.#usingSdk((client) => client.capabilities.get(id)),
		estimate: (id: string, input: unknown, opts: RunOptions = {}) =>
			this.#usingSdk(
				(client) => client.capabilities.estimate(id, input, opts),
				opts,
			),
	};

	readonly outcomes = {
		list: () => this.#usingSdk((client) => client.outcomes.list()),
		get: (id: string) => this.#usingSdk((client) => client.outcomes.get(id)),
		estimate: (id: string, input: unknown, opts: OutcomeRunOptions = {}) =>
			this.#usingSdk(
				(client) => client.outcomes.estimate(id, input, opts),
				opts,
			),
		run: async (
			id: string,
			input: unknown,
			opts: OutcomeRunOptions = {},
		): Promise<OutcomeRun> => {
			const started = await this.#usingSdk(
				(client) => client.outcomes.start(id, input, opts),
				opts,
			);
			if (!("id" in started)) return started;
			const jobId = started.id;
			let job: Job;
			try {
				job = await this.jobs.wait(jobId, {
					timeoutMs: 36 * 60_000,
					...(opts.signal ? { signal: opts.signal } : {}),
				});
			} catch (error) {
				throw new PramaanError(
					error instanceof PramaanError ? error.code : "upstream_unavailable",
					"The accepted research job could not be confirmed. Check its status before retrying.",
					{ jobId },
				);
			}
			if (job.result !== undefined) {
				const report = toOutcomeRun(job.result);
				return {
					...report,
					...(job.status === "failed" || job.status === "cancelled"
						? { status: job.status }
						: {}),
					...(!report.error && job.error ? { error: job.error } : {}),
				};
			}
			throw new PramaanError(
				job.error?.code ?? "internal",
				job.error?.message ?? `The run ended with status "${job.status}".`,
				{ jobId },
			);
		},
	};

	/**
	 * Runs `llm.chat` and yields the reply as it is generated (PRA-10). The last event is
	 * `done`, with the same result the plain call returns. A failure, before or during the
	 * stream, throws a PramaanError. A capability that does not stream, and a replayed
	 * Idempotency-Key, yield one `done`. Never retried: a retry would generate, and
	 * charge, a second reply.
	 */
	async *llmChatStream(
		input: unknown,
		opts: RunOptions = {},
	): AsyncGenerator<LlmChatStreamEvent> {
		let failure: PramaanError | undefined;
		const client = new PublishedPramaan({
			...this.#sdkOptions,
			maxRetries: 0,
			fetch: async (url, init) => {
				const response = await this.#fetch(url, init);
				if (!response.ok) failure = await errorFromResponse(response.clone());
				return response;
			},
		});
		try {
			yield* client.stream("llm.chat", input as never, opts);
		} catch (error) {
			throw failure ?? error;
		}
	}
}

type Raw = Record<string, unknown>;

export function toOutcomeRun(body: unknown): OutcomeRun {
	const raw = (body ?? {}) as Raw;
	const cost = (raw.cost ?? {}) as Raw;
	if (typeof raw.outcome !== "string" || typeof raw.status !== "string") {
		throw new PramaanError(
			"internal",
			"The API returned an unexpected run shape.",
		);
	}
	return {
		outcome: raw.outcome,
		version: Number(raw.version ?? 1),
		plan: String(raw.plan),
		status: raw.status as OutcomeRun["status"],
		...(typeof raw.completeness === "string"
			? {
					completeness: raw.completeness as NonNullable<
						OutcomeRun["completeness"]
					>,
				}
			: {}),
		...("result" in raw ? { result: raw.result } : {}),
		evidence: (raw.evidence ?? {}) as Record<string, unknown>,
		missing: (raw.missing ?? []) as unknown[],
		steps: ((raw.steps ?? []) as Raw[]).map(
			(step): OutcomeRunStep => ({
				id: String(step.id),
				label: String(step.label),
				capability: String(step.capability),
				effectClass: step.effect_class as OutcomeRunStep["effectClass"],
				status: String(step.status) as OutcomeRunStep["status"],
				calls: Number(step.calls ?? 0),
				effect: String(step.effect) as OutcomeRunStep["effect"],
				...(typeof step.reason === "string" ? { reason: step.reason } : {}),
				...(Array.isArray(step.errors)
					? { errors: step.errors as NonNullable<OutcomeRunStep["errors"]> }
					: {}),
			}),
		),
		...(raw.error
			? { error: raw.error as NonNullable<OutcomeRun["error"]> }
			: {}),
		cost: {
			holdMicro: Number(cost.hold_micro ?? 0),
			chargedMicro: Number(cost.charged_micro ?? 0),
			capabilities: ((cost.capabilities ?? []) as Raw[]).map((row) => ({
				id: String(row.id),
				calls: Number(row.calls ?? 0),
				chargedMicro: Number(row.charged_micro ?? 0),
			})),
		},
	};
}
