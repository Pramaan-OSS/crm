import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { OriginNote, originNote } from "../app/(landing)/sign-in/origin-note";

// The auth server refuses cookie-bearing sign-in and sign-out POSTs from any
// origin outside APP_URL (+ its loopback aliases). The sign-in page must say
// so when the browser is somewhere else — naming both origins and the fix.

describe("originNote", () => {
	it("is silent when the browser is on the served origin", () => {
		expect(originNote("http://localhost:3000", "http://localhost:3000")).toBe(
			null,
		);
	});

	it("is silent before the browser origin is known", () => {
		expect(originNote(null, "http://localhost:3000")).toBe(null);
	});

	it("names both origins and the fix on a mismatch", () => {
		const note = originNote(
			"http://localhost:3010",
			"http://localhost:3000",
		) as string;

		expect(note).toContain("http://localhost:3010");
		expect(note).toContain("http://localhost:3000");
		expect(note).toContain("APP_URL");
		expect(note).toContain("signing in and out is refused");
	});

	it("fires for a host mismatch too, not just a port", () => {
		expect(originNote("http://127.0.0.1:3000", "http://localhost:3000")).toContain(
			"127.0.0.1:3000",
		);
	});
});

describe("OriginNote", () => {
	it("renders nothing on the server, so hydration starts clean", () => {
		expect(renderToStaticMarkup(<OriginNote appUrl="http://localhost:3000" />)).toBe(
			"",
		);
	});
});
