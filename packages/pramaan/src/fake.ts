// A fake Pramaan for tests: no network, no key. Route handlers answer each capability;
// anything unrouted throws, so a test fails loudly when code reaches for the network.

import {
	type CapId,
	type CapsCallInput,
	type CapsCallResult,
	Pramaan,
	PramaanClient,
} from "./index";
import type { RunOptions } from "./sdk/types";

export type RouteHandler = (
	input: unknown,
	opts: RunOptions | undefined,
) => unknown | Promise<unknown>;

export class FakePramaan extends Pramaan {
	readonly calls: {
		id: string;
		input: unknown;
		opts: RunOptions | undefined;
	}[] = [];
	readonly #routes: Readonly<Record<string, RouteHandler>>;

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
}
