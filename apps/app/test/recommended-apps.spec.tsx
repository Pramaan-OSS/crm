import { describe, expect, it, test } from "bun:test";

// The managed-connect rows and the chained calendar connect are pure
// decisions over the status payloads, so they are testable without a
// browser: the platform's localhost redirect refusal makes live UI
// verification impossible here.

import { calendarChainNeeded } from "../app/(app)/[slug]/settings/connections/google-connection";
import { recommendedAppRows } from "../components/connections/recommended-apps";

const slug = "crm";

const google = (gmail: boolean, calendar: boolean) => ({
	linked: gmail,
	sources: [
		{ source: "gmail", connected: gmail, status: null, lastError: null },
		{
			source: "calendar",
			connected: calendar,
			status: null,
			lastError: null,
		},
	],
});

const microsoft = (outlook: boolean) => ({
	linked: outlook,
	sources: [
		{
			source: "outlook",
			connected: outlook,
			status: null,
			lastError: null,
		},
	],
});

const bothOff = { google: google(false, false), microsoft: microsoft(false) };
const bothOn = { google: google(true, true), microsoft: microsoft(true) };

describe("recommendedAppRows", () => {
	it("lists only the apps the CRM uses — Gmail, Calendar, Outlook", () => {
		const rows = recommendedAppRows({ ...bothOff, slug });
		expect(rows.map((row) => row.name)).toEqual([
			"Gmail",
			"Google Calendar",
			"Outlook",
		]);
	});

	it("a connected row shows Manage pointing at its settings page", () => {
		const rows = recommendedAppRows({ ...bothOn, slug });
		for (const row of rows) {
			expect(row.action.kind).toBe("manage");
		}
		if (rows[0]?.action.kind === "manage")
			expect(rows[0].action.href).toBe(`/${slug}/settings/connections/google`);
		if (rows[2]?.action.kind === "manage")
			expect(rows[2].action.href).toBe(
				`/${slug}/settings/connections/microsoft`,
			);
	});

	it("an unconnected row offers connect through the right router", () => {
		const rows = recommendedAppRows({ ...bothOff, slug });
		const [gmail, calendar, outlook] = rows;
		expect(gmail?.action).toEqual({
			kind: "connect",
			router: "google",
			source: "gmail",
			href: `/${slug}/settings/connections/google`,
		});
		expect(calendar?.action).toEqual({
			kind: "connect",
			router: "google",
			source: "calendar",
			href: `/${slug}/settings/connections/google`,
		});
		expect(outlook?.action).toEqual({
			kind: "connect",
			router: "microsoft",
			source: "outlook",
			href: `/${slug}/settings/connections/microsoft`,
		});
	});

	it("reports a source that needs reconnecting", () => {
		const rows = recommendedAppRows({
			slug,
			google: {
				linked: true,
				sources: [
					{ source: "gmail", connected: true, status: null, lastError: null },
					{
						source: "calendar",
						connected: true,
						status: "NEEDS_RECONNECT",
						lastError: null,
					},
				],
			},
			microsoft: microsoft(false),
		});

		expect(rows[1]?.status).toBe("Needs reconnecting");
	});
});

describe("the chained calendar connect", () => {
	it("chains when Gmail connected and Calendar did not", () => {
		expect(calendarChainNeeded(google(true, false).sources)).toBe(true);
	});

	it("does not chain when both are connected", () => {
		expect(calendarChainNeeded(google(true, true).sources)).toBe(false);
	});

	it("does not chain when Gmail itself did not connect", () => {
		expect(calendarChainNeeded(google(false, false).sources)).toBe(false);
		expect(calendarChainNeeded(google(false, true).sources)).toBe(false);
	});
});
