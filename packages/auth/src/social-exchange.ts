// The sign-in code exchange, through the platform. The app hands `auth.social.exchange`
// the code the provider returned; the platform — which holds the builder's connected
// sign-in account, secret included — verifies it and answers with identity only. No
// provider token ever reaches this process, and no provider token endpoint is called
// from here.

import { randomUUID } from "node:crypto";
import { type Caps, type Pramaan, pramaanFromEnv } from "@crm/pramaan";

export type SocialProviderKey = "google" | "microsoft";

export type ExchangedIdentity = Caps.AuthSocialExchangeResult;

/**
 * Identity results parked between the code exchange and better-auth's user-info step.
 * The two happen back to back in the same callback request; the opaque access token is
 * only the key, and entries are single-use.
 */
const pendingIdentities = new Map<string, ExchangedIdentity>();

function client(): Pramaan | null {
	return pramaanFromEnv();
}

/** True when sign-in through the platform can exchange codes. */
export function platformSignInAvailable(): boolean {
	return client() !== null;
}

/** A short-lived handle better-auth can carry; the identity itself never serialises. */
function park(identity: ExchangedIdentity): string {
	const handle = randomUUID();
	pendingIdentities.set(handle, identity);
	return handle;
}

export async function exchangeSignInCode(
	providerKey: SocialProviderKey,
	data: {
		readonly code: string;
		readonly redirectURI: string;
		readonly codeVerifier?: string;
	},
): Promise<{ accessToken: string }> {
	const api = client();
	if (!api) {
		throw new Error(
			"Sign-in is not configured: set PRAMAAN_API_KEY so the platform can verify the sign-in code.",
		);
	}

	const identity = await api.authSocialExchange(
		{
			providerKey,
			code: data.code,
			redirectUri: data.redirectURI,
			...(data.codeVerifier ? { pkceVerifier: data.codeVerifier } : {}),
		},
		{ idempotencyKey: `sign-in-${providerKey}-${randomUUID()}` },
	);

	return { accessToken: park(identity) };
}

/** better-auth's user-info step: reads back what the exchange verified. */
export function identityFromTokenHandle(accessToken: string | undefined): {
	id: string;
	name?: string;
	email?: string | null;
	image?: string;
	emailVerified: boolean;
} | null {
	if (!accessToken) return null;
	const identity = pendingIdentities.get(accessToken);
	if (!identity) return null;
	pendingIdentities.delete(accessToken);

	return {
		id: identity.subjectId,
		...(identity.displayName ? { name: identity.displayName } : {}),
		...(identity.email ? { email: identity.email } : {}),
		...(identity.pictureUrl ? { image: identity.pictureUrl } : {}),
		emailVerified: identity.emailVerified ?? false,
	};
}
