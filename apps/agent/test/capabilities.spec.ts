import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Pramaan } from "@crm/pramaan";
import {
	capabilitiesFrom,
	markdownFor,
	unavailable,
} from "../agent/lib/capabilities";

const savedKey = process.env.PRAMAAN_API_KEY;

beforeEach(() => {
	delete process.env.PRAMAAN_API_KEY;
});

afterEach(() => {
	if (savedKey !== undefined) process.env.PRAMAAN_API_KEY = savedKey;
	else delete process.env.PRAMAAN_API_KEY;
});

const withInfo = (ids: string[]): Pramaan =>
	({
		info: (id: string) => (ids.includes(id) ? { id } : undefined),
	}) as unknown as Pramaan;

const allOn = withInfo([
	"web.answers",
	"companies.enrich",
	"people.enrich",
	"storage.object.upload-url",
]);

describe("capabilities", () => {
	it("reports everything off when there is no Pramaan client", () => {
		expect(capabilitiesFrom(null).every((c) => !c.enabled)).toBe(true);
	});

	it("turns everything on together, because it is one key", () => {
		expect(capabilitiesFrom(allOn).every((c) => c.enabled)).toBe(true);
	});

	it("stays off for a capability the platform does not serve", () => {
		const partial = withInfo(["web.answers"]);

		expect(
			capabilitiesFrom(partial).find((c) => c.id === "people")?.enabled,
		).toBe(false);
		expect(
			capabilitiesFrom(partial).find((c) => c.id === RESEARCH_ID)?.enabled,
		).toBe(true);
	});

	it("does not let a stray variable turn anything on", () => {
		process.env.SOMETHING_ELSE = "x";

		expect(capabilitiesFrom(null).every((c) => !c.enabled)).toBe(true);

		delete process.env.SOMETHING_ELSE;
	});
});

describe("the unavailable result", () => {
	it("says retrying will not help", () => {
		const result = unavailable("LinkedIn");

		expect(result.ok).toBe(false);
		expect(result.configured).toBe(false);
		expect(result.reason).toContain("retrying will not help");
		expect(result.reason).toContain("LinkedIn");
	});
});

describe("the capability briefing", () => {
	it("tells a bare install to work from the CRM alone", () => {
		const markdown = markdownFor(capabilitiesFrom(null));

		expect(markdown).toContain("No outside sources are configured");
		expect(markdown).toContain("read_crm_history");
	});

	it("lists what is on and what is off, separately", () => {
		const partial = withInfo(["web.answers"]);
		const markdown = markdownFor(capabilitiesFrom(partial));

		expect(markdown).toContain("Web research");
		expect(markdown).toContain("not configured on this install");
		expect(markdown).toContain("LinkedIn");
	});

	it("does not warn about missing sources when everything is on", () => {
		expect(markdownFor(capabilitiesFrom(allOn))).not.toContain(
			"not configured on this install",
		);
	});
});

const RESEARCH_ID = "web-research";
