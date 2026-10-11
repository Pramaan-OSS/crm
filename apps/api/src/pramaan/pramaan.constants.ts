import { type Pramaan, pramaanFromEnv } from "@crm/pramaan";
import { Inject, Injectable } from "@nestjs/common";

export const PRAMAAN = Symbol("PRAMAAN");

/** The workspace's Pramaan client, or null when no key is set. */
@Injectable()
export class PramaanClientProvider {
	private client: Pramaan | null | undefined;

	clientFromEnv(): Pramaan | null {
		if (this.client !== undefined) return this.client;

		this.client = pramaanFromEnv({
			PRAMAAN_API_KEY: process.env.PRAMAAN_API_KEY,
			PRAMAAN_BASE_URL: process.env.PRAMAAN_BASE_URL,
		});

		return this.client;
	}
}

export function InjectPramaan() {
	return Inject(PRAMAAN);
}
