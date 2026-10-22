import "@crm/env/load";

const DEFAULT_API_URL = "http://localhost:3001";
const DEFAULT_APP_URL = "http://localhost:3000";
const DEFAULT_MICROSOFT_TENANT = "common";

const optional = (key: string): string | undefined => {
	const value = process.env[key];
	return value && value.length > 0 ? value : undefined;
};

// Only the public client id lives here. The client secret belongs to the
// builder's connected sign-in account on the platform, which performs the code
// exchange (auth.social.exchange) — the app never sees a secret or a token.
const publicId = (key: string): string | undefined => {
	const value = optional(key);
	if (!value) return undefined;
	return value;
};

const googleClientId = publicId("GOOGLE_CLIENT_ID");

const microsoftClientId = publicId("MICROSOFT_CLIENT_ID");

const apiUrl =
	optional("API_URL") ?? optional("BETTER_AUTH_URL") ?? DEFAULT_API_URL;

const appUrls = (optional("APP_URL") ?? DEFAULT_APP_URL)
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);

const appUrl = appUrls[0] ?? DEFAULT_APP_URL;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "[::]"]);

/**
 * The loopback aliases of a loopback origin: the same app reached as
 * localhost, 127.0.0.1 or [::1]. The CSRF origin check is strict about the
 * host, so a person who opened the app at 127.0.0.1 instead of localhost (or
 * the reverse) would otherwise be signed in fine and then refused at the
 * first cookie-bearing auth POST — sign-out. Non-loopback origins are never
 * aliased; set APP_URL to the origin you actually serve.
 */
export function loopbackAliases(origin: string): string[] {
	try {
		const url = new URL(origin);
		if (!LOOPBACK_HOSTS.has(url.hostname)) return [];
		const aliases: string[] = [];
		for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
			if (host === url.hostname) continue;
			aliases.push(`${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`);
		}
		return aliases;
	} catch {
		return [];
	}
}

/** The CSRF-trusted origins: the app's origins, the API, and loopback aliases. */
export function computeTrustedOrigins(origins: readonly string[]): string[] {
	return [
		...new Set(
			origins.flatMap((origin) => [origin, ...loopbackAliases(origin)]),
		),
	];
}

export const env = {
	apiUrl,
	appUrl,
	google: googleClientId ? { clientId: googleClientId } : undefined,
	microsoft: microsoftClientId
		? {
				clientId: microsoftClientId,
				tenantId: optional("MICROSOFT_TENANT_ID") ?? DEFAULT_MICROSOFT_TENANT,
			}
		: undefined,
	cookieDomain: optional("AUTH_COOKIE_DOMAIN"),
	trustedOrigins: computeTrustedOrigins([...appUrls, apiUrl]),
	isProduction: process.env.NODE_ENV === "production",
} as const;

export function isGoogleConfigured(): boolean {
	return env.google !== undefined;
}

export function isMicrosoftConfigured(): boolean {
	return env.microsoft !== undefined;
}

const trustedOrigins = env.trustedOrigins;

export { apiUrl, appUrl, trustedOrigins };
