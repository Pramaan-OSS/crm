// The agent's doorway to Pramaan. Every outside call this process makes — web research,
// company and people enrichment, picture storage — goes through this client.

import "@crm/env/load";

import { type Pramaan, pramaanFromEnv, pramaanKeySet } from "@crm/pramaan";
import { directPaidRun } from "./direct-paid-run";
import { paidRun } from "./paid-run";
import { agentTransport } from "./pramaan-transport";
import { reserveSpend, spendLedgerRoot } from "./run-safety";

let client: Pramaan | null | undefined;

export function pramaanEnabled(): boolean {
	return pramaanKeySet();
}

/** Tests toggle the key and call this, so the next read re-resolves from the environment. */
export function resetPramaanForTests(): void {
	client = undefined;
}

/** The shared client, or null when this install has no Pramaan key. */
export function pramaan(): Pramaan | null {
	if (client !== undefined) return client;

	client = pramaanFromEnv({
		fetch: agentTransport({
			fetch: (url, init) => fetch(url, init),
			run: () => directPaidRun.getStore() ?? paidRun.get(),
			reserve: (run, amount) => reserveSpend(spendLedgerRoot(), run, amount),
		}),
	});

	return client;
}
