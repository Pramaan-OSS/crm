import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

// The managed sign-in's return page (/sign-in/managed/return) renders before
// the local session exists — the proxy used to bounce it to /sign-in, so the
// person finished signing in on the backend and landed back on the sign-in
// page, unsigned in.

const request = (path: string) =>
	new NextRequest(`http://localhost:3110${path}`, {
		headers: { host: "localhost:3110" },
	});

const isRedirectToSignIn = async (response: Response) => {
	const location = response.headers.get("location");
	return (
		response.status === 307 && location === "http://localhost:3110/sign-in"
	);
};

describe("the pre-auth proxy", () => {
	it("lets the managed sign-in return page render before there is a session", async () => {
		const response = await proxy(request("/sign-in/managed/return"));

		expect(await isRedirectToSignIn(response)).toBe(false);
	});

	it("lets the sign-in page through, as before", async () => {
		const response = await proxy(request("/sign-in"));

		expect(await isRedirectToSignIn(response)).toBe(false);
	});

	it("still sends an unsigned request for the app itself to the sign-in page", async () => {
		const response = await proxy(request("/companies"));

		expect(await isRedirectToSignIn(response)).toBe(true);
	});
});
