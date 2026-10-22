import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { fetchManagedJwt } from "../lib/managed-auth-client";

const AUTH_URL = "https://managed-auth.example.test";
const JWT = "header.payload.signature";

type Call = { url: string; credentials?: string };
let calls: Call[] = [];
let responses: { status: number; body?: unknown }[] = [];

const realFetch = globalThis.fetch;

// Stub fetch, recording every call and answering from the queue.
function stubFetch() {
	calls = [];
	responses = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, credentials: init?.credentials as string | undefined });
		const next = responses.shift();
		return new Response(
			next?.status === 500 ? "no" : JSON.stringify(next?.body ?? {}),
			{
				status: next?.status ?? 200,
				headers: { "content-type": "application/json" },
			},
		);
	}) as typeof fetch;
}

beforeEach(stubFetch);

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("fetchManagedJwt", () => {
	it("finalises the session with the redirect's one-time verifier, then reads the token", async () => {
		responses = [
			{ status: 200, body: {} },
			{ status: 200, body: { token: JWT } },
		];
		const verifier = "one-time-verifier-value";

		const token = await fetchManagedJwt(AUTH_URL, verifier);

		expect(token).toBe(JWT);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toBe(
			`${AUTH_URL}/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`,
		);
		expect(calls[0]?.credentials).toBe("include");
		expect(calls[1]?.url).toBe(`${AUTH_URL}/token`);
		expect(calls[1]?.credentials).toBe("include");
	});

	it("goes straight to the token when there is no verifier (the email flow)", async () => {
		responses = [{ status: 200, body: { token: JWT } }];

		const token = await fetchManagedJwt(AUTH_URL, null);

		expect(token).toBe(JWT);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(`${AUTH_URL}/token`);
	});

	it("still tries the token when the verifier exchange fails", async () => {
		responses = [{ status: 500 }, { status: 200, body: { token: JWT } }];

		const token = await fetchManagedJwt(AUTH_URL, "stale-verifier");

		expect(calls).toHaveLength(2);
		expect(calls[1]?.url).toBe(`${AUTH_URL}/token`);
		expect(token).toBe(JWT);
	});

	it("answers null when the token read is refused", async () => {
		responses = [{ status: 401 }];

		const token = await fetchManagedJwt(AUTH_URL, null);

		expect(token).toBeNull();
	});
});
