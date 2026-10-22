// A fake Pramaan for tests: no network, no key. Route handlers answer each capability;
// anything unrouted throws, so a test fails loudly when code reaches for the network.

import { validateGenerationSchemas } from "./json-schema";
import { PramaanError } from "./sdk/errors";

/**
 * The action calls production refuses without an Idempotency-Key header
 * (400 invalid_request). Read-only capabilities do not need one.
 */
const IDEMPOTENCY_REQUIRED: ReadonlySet<string> = new Set([
	"apps.connection.start",
	"auth.backend.provision",
	"auth.backend.domains.set",
	"auth.backend.social.set",
	"auth.backend.social.remove",
	"auth.backend.delete",
	"auth.backend.transfer",
	"auth.user.delete",
	"db.postgres.provision",
	"db.postgres.credential.rotate",
	"db.postgres.delete",
]);

import {
	type CapId,
	type CapsCallInput,
	type CapsCallResult,
	Pramaan,
	PramaanClient,
} from "./index";
import type {
	LlmChatStreamEvent,
	OutcomeRunOptions,
	RunOptions,
} from "./sdk/types";

export type RouteHandler = (
	input: unknown,
	opts: RunOptions | undefined,
) => unknown | Promise<unknown>;

export type OutcomeRouteHandler = (
	input: unknown,
) => unknown | Promise<unknown>;

export type OutcomeRoutes = {
	list?: () => unknown[] | Promise<unknown[]>;
	get?: (id: string) => unknown | Promise<unknown>;
	estimate?: (
		id: string,
		input: unknown,
		opts?: OutcomeRunOptions,
	) => unknown | Promise<unknown>;
	run?: (
		id: string,
		input: unknown,
		opts?: OutcomeRunOptions,
	) => unknown | Promise<unknown>;
};

export class FakePramaan extends Pramaan {
	fileCalls: string[] = [];
	fileRoute?: (fileId: string) => Response | Promise<Response>;
	override async fileDownload(fileId: string): Promise<Response> {
		this.fileCalls.push(fileId);
		if (!this.fileRoute) throw new Error("FakePramaan has no file route.");
		return this.fileRoute(fileId);
	}

	readonly calls: {
		id: string;
		input: unknown;
		opts: RunOptions | undefined;
	}[] = [];
	#routes: Readonly<Record<string, RouteHandler>>;

	constructor(routes: Record<string, RouteHandler> = {}) {
		// The parent only wraps a real client for its typed helpers; no call ever reaches it
		// because `call` is overridden below.
		super(
			new PramaanClient({
				apiKey: "fake",
				fetch: () =>
					Promise.reject(new Error("FakePramaan never reaches the network.")),
			}),
		);
		this.#routes = routes;
	}

	override async call<Id extends CapId>(
		id: Id,
		input: CapsCallInput<Id>,
		opts?: RunOptions,
	): Promise<CapsCallResult<Id>> {
		if (id === "llm.chat" || id === "llm.complete")
			validateGenerationSchemas(input);
		// Production refuses these action calls without an Idempotency-Key
		// header (400 invalid_request); the fake refuses the same way, so a
		// test that would fail live fails here.
		if (IDEMPOTENCY_REQUIRED.has(id) && !opts?.idempotencyKey) {
			throw new PramaanError(
				"invalid_request",
				"Idempotency-Key header is required for this capability.",
			);
		}
		this.calls.push({ id, input, opts });
		const route = this.#routes[id];
		if (!route) {
			throw new Error(
				`FakePramaan has no route for "${id}". Add one in the test.`,
			);
		}
		return (await route(input, opts)) as CapsCallResult<Id>;
	}

	/** Every call made to a capability id, in order. */
	callsTo(id: CapId): unknown[] {
		return this.calls
			.filter((entry) => entry.id === id)
			.map((entry) => entry.input);
	}

	readonly outcomeCalls: {
		verb: string;
		id?: string;
		input: unknown;
		opts?: OutcomeRunOptions;
	}[] = [];
	#outcomeRoutes: OutcomeRoutes = {};

	/** Route one or more outcome verbs; an unrouted verb throws, like `call` does. */
	routeOutcomes(routes: OutcomeRoutes): void {
		this.#outcomeRoutes = { ...this.#outcomeRoutes, ...routes };
	}

	/** Route one or more capability calls after construction. */
	route(
		routes: Record<string, (input: unknown, opts?: RunOptions) => unknown>,
	): void {
		this.#routes = { ...this.#routes, ...routes };
	}

	readonly streamCalls: { id: string; input: unknown }[] = [];
	#streamRoutes: {
		/** Async generator of stream events; throw inside for a refused/dropped stream. */
		route?: (input: unknown) => AsyncGenerator<LlmChatStreamEvent>;
	} = {};

	/** Route the llm.chat stream; an unrouted id throws, like `call` does. */
	routeStream(
		route: (input: unknown) => AsyncGenerator<LlmChatStreamEvent>,
	): void {
		this.#streamRoutes = { route };
	}

	override get outcomes() {
		type Outcomes = PramaanClient["outcomes"];
		return {
			list: async (): Promise<Awaited<ReturnType<Outcomes["list"]>>> => {
				this.outcomeCalls.push({ verb: "list", input: null });
				if (!this.#outcomeRoutes.list)
					throw new Error(
						"FakePramaan has no outcomes.list route. Add one in the test.",
					);
				return (await this.#outcomeRoutes.list()) as Awaited<
					ReturnType<Outcomes["list"]>
				>;
			},
			get: async (
				id: string,
			): Promise<Awaited<ReturnType<Outcomes["get"]>>> => {
				this.outcomeCalls.push({ verb: "get", id, input: null });
				if (!this.#outcomeRoutes.get)
					throw new Error(`FakePramaan has no outcomes.get route for "${id}".`);
				return (await this.#outcomeRoutes.get(id)) as Awaited<
					ReturnType<Outcomes["get"]>
				>;
			},
			estimate: async (
				id: string,
				input: unknown,
				opts?: OutcomeRunOptions,
			): Promise<Awaited<ReturnType<Outcomes["estimate"]>>> => {
				this.outcomeCalls.push({ verb: "estimate", id, input, opts });
				if (!this.#outcomeRoutes.estimate)
					throw new Error(
						`FakePramaan has no outcomes.estimate route for "${id}".`,
					);
				return (await this.#outcomeRoutes.estimate(id, input, opts)) as Awaited<
					ReturnType<Outcomes["estimate"]>
				>;
			},
			run: async (
				id: string,
				input: unknown,
				opts?: OutcomeRunOptions,
			): Promise<Awaited<ReturnType<Outcomes["run"]>>> => {
				this.outcomeCalls.push({ verb: "run", id, input, opts });
				if (!this.#outcomeRoutes.run)
					throw new Error(`FakePramaan has no outcomes.run route for "${id}".`);
				return (await this.#outcomeRoutes.run(id, input, opts)) as Awaited<
					ReturnType<Outcomes["run"]>
				>;
			},
		};
	}

	override llmChatStream(
		input: unknown,
		_opts?: RunOptions,
	): AsyncGenerator<LlmChatStreamEvent> {
		const self = this;
		async function* routed(): AsyncGenerator<LlmChatStreamEvent> {
			validateGenerationSchemas(input);
			self.streamCalls.push({ id: "llm.chat", input });
			if (!self.#streamRoutes.route)
				throw new Error(
					'FakePramaan has no stream route for "llm.chat". Add one in the test.',
				);
			yield* self.#streamRoutes.route(input);
		}
		return routed();
	}
}
