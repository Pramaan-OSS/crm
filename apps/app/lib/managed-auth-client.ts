"use client";

import { createAuthClient } from "better-auth/react";

export const MANAGED_RETURN_PATH = "/sign-in/managed/return";

/**
 * The one-time verifier the backend appends to its sign-in redirect after an
 * OAuth round-trip. Presenting it to get-session finalises the session cookie
 * in this origin's partition. Protocol detail — code only, never UI or logs.
 */
export const SESSION_VERIFIER_PARAM = "neon_auth_session_verifier";

/**
 * The sign-in client for the managed sign-in backend: a Better Auth server
 * whose base address the platform provisions (authUrl). The browser talks to
 * it directly; after sign-in the app's own callback route exchanges the
 * backend session token for the normal local session.
 */
export function createManagedClient(authUrl: string) {
	return createAuthClient({ baseURL: authUrl });
}

/**
 * The backend's session JWT. After an OAuth round-trip the redirect carries a
 * one-time verifier: get-session is called with it first (credentials
 * included), which finalises the session cookie in this origin's cookie
 * partition — only then does /token answer. The email flow sets the cookie
 * by its own fetch and arrives here without a verifier.
 */
export async function fetchManagedJwt(
	authUrl: string,
	verifier?: string | null,
): Promise<string | null> {
	if (verifier) {
		await fetch(
			`${authUrl}/get-session?${SESSION_VERIFIER_PARAM}=${encodeURIComponent(verifier)}`,
			{ credentials: "include", headers: { accept: "application/json" } },
		).catch(() => null);
	}

	const response = await fetch(`${authUrl}/token`, {
		credentials: "include",
		headers: { accept: "application/json" },
	});
	if (!response.ok) return null;
	const body = (await response.json().catch(() => null)) as {
		token?: string;
	} | null;
	return body?.token ?? null;
}
