// Managed sign-in: the sign-in backend the platform provisions for this
// project (auth.backend.setup). Opened once per boot and reused; the
// sign-in page offers it whenever the install has no sign-in provider of its
// own. Everything runs through the one Pramaan client.

import "@crm/env/load";

import {
	type Pramaan,
	PramaanError,
	pramaanFromEnv,
	runOutcomeFlow,
} from "@crm/pramaan";
import { appUrl } from "./env";

export type ManagedBackend = {
	readonly authUrl: string;
	readonly jwksUrl: string;
};

let injectedForTests: Pramaan | null | undefined;
let cached: ManagedBackend | null | undefined;
let inFlight: Promise<ManagedBackend | null> | undefined;
let retryAfter = 0;

/** How long a refused provision stays refused before the lazy path retries. */
const RETRY_AFTER_MS = 60_000;

/** Tests inject a fake client here; the next call re-resolves. */
export function setManagedPramaanForTests(client: Pramaan | null): void {
	injectedForTests = client;
	cached = undefined;
	inFlight = undefined;
	retryAfter = 0;
}

export function managedPramaan(): Pramaan | null {
	if (injectedForTests !== undefined) return injectedForTests;
	return pramaanFromEnv();
}

/** The backend opened this boot, or null when there is none (no key, or refused). */
export function managedBackend(): ManagedBackend | null {
	return cached ?? null;
}

/** Public HTTPS origins and explicit loopback development origins. */
export function managedReturnOrigins(): string[] {
	try {
		const url = new URL(appUrl);
		if (
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		)
			return [];
		if (
			["localhost", "127.0.0.1"].includes(url.hostname) &&
			["http:", "https:"].includes(url.protocol)
		)
			return [url.origin];
		if (
			url.protocol === "https:" &&
			url.hostname.includes(".") &&
			!/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
		)
			return [url.origin];
	} catch {}
	return [];
}

/**
 * Open (or reuse) the managed sign-in backend. Idempotent on the platform
 * side, so calling this is free. Returns null when there is no key or the
 * platform refused; callers say so plainly.
 *
 * A refused provision is remembered for a minute, not forever: the process
 * may have booted on a key that was broken then and fixed since, so the lazy
 * path (signInOptions) retries after the window passes. `force` retries now.
 */
export async function ensureManagedBackend(
	client: Pramaan | null = managedPramaan(),
	opts: { force?: boolean } = {},
): Promise<ManagedBackend | null> {
	if (inFlight) return inFlight;
	if (!client) {
		cached = null;
		return null;
	}
	if (!opts.force) {
		if (cached) return cached;
		if (cached === null && Date.now() < retryAfter) return null;
	}

	inFlight = (async () => {
		try {
			const domains = managedReturnOrigins();
			if (!domains.length) throw new Error("Invalid return origin");
			const attempt = await runOutcomeFlow(
				client,
				"auth.backend.setup",
				{ domains },
				{},
				{},
				true,
			);
			if (attempt.state !== "done")
				throw new Error("Sign-in setup could not be confirmed");
			const result = attempt.report.result as
				| { status?: string; allowedDomains?: string[] }
				| undefined;
			const allowedDomains = result?.allowedDomains;
			if (
				result?.status !== "ready" ||
				!Array.isArray(allowedDomains) ||
				domains.some((d) => !allowedDomains.includes(d))
			)
				throw new Error("Return origins were not confirmed");
			// Setup deliberately withholds backend URLs; read them after confirmed setup.
			const backend = await client.authBackendGet();
			if (backend.status !== "ready") throw new Error("Backend is not ready");
			cached = { authUrl: backend.authUrl, jwksUrl: backend.jwksUrl };
			retryAfter = 0;

			return cached;
		} catch (error) {
			cached = null;
			retryAfter = Date.now() + RETRY_AFTER_MS;
			// Plain reason, no key and no provider name — the sign-in page keeps
			// retrying after the window, so this is a note, not a dead end.
			console.error(
				`Managed sign-in: the platform refused to open the backend (${reasonOf(error)}); it will retry in a minute.`,
			);
			return null;
		} finally {
			inFlight = undefined;
		}
	})();

	return inFlight;
}

/** Tests: forget this boot's backend and injected client. */
export function resetManagedForTests(): void {
	cached = undefined;
	inFlight = undefined;
	retryAfter = 0;
	injectedForTests = undefined;
}

function reasonOf(error: unknown): string {
	if (error instanceof PramaanError) {
		return error.code;
	}
	return "setup could not be confirmed";
}

export type ManagedTokenClaims = {
	readonly sub: string;
	readonly email?: string;
	readonly emailVerified?: boolean;
	readonly name?: string;
};

/**
 * The verified token's payload, decoded without checking the signature: the
 * platform's auth.token.verify has already said the token is genuine; this
 * only reads who it is for (the result carries no email). Callers must check
 * that `sub` matches the userId verify returned before trusting the claims.
 */
export function managedTokenClaims(token: string): ManagedTokenClaims | null {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[1]) return null;
	try {
		const json = Buffer.from(parts[1], "base64url").toString("utf8");
		const payload = JSON.parse(json) as Record<string, unknown>;
		if (typeof payload.sub !== "string") return null;
		return {
			sub: payload.sub,
			email: typeof payload.email === "string" ? payload.email : undefined,
			emailVerified:
				typeof payload.emailVerified === "boolean"
					? payload.emailVerified
					: undefined,
			name: typeof payload.name === "string" ? payload.name : undefined,
		};
	} catch {
		return null;
	}
}
