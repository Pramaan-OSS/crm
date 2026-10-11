// The agent's doorway to Pramaan. Every outside call this process makes — web research,
// company and people enrichment, picture storage — goes through this client.

import "@crm/env/load";

import { type Pramaan, pramaanFromEnv } from "@crm/pramaan";

let client: Pramaan | null | undefined;

export function pramaanEnabled(): boolean {
	return Boolean(process.env.PRAMAAN_API_KEY?.trim());
}

/** Tests toggle the key and call this, so the next read re-resolves from the environment. */
export function resetPramaanForTests(): void {
	client = undefined;
}

/** The shared client, or null when this install has no Pramaan key. */
export function pramaan(): Pramaan | null {
	if (client !== undefined) return client;

	client = pramaanFromEnv({
		PRAMAAN_API_KEY: process.env.PRAMAAN_API_KEY,
		PRAMAAN_BASE_URL: process.env.PRAMAAN_BASE_URL,
	});

	return client;
}
