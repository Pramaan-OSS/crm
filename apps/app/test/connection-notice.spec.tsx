import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
	ConnectionNotice,
	connectionNotice,
} from "../components/connections/connection-notice";

// The connect screens must state the grant plainly — and what this app does with
// it — before the person leaves for the hosted connect link. Never "read-only":
// the connector's grant is broader than what this app does with it.

const MARKUP = (slug: string, appName: string) =>
	renderToStaticMarkup(<ConnectionNotice slug={slug} appName={appName} />);

describe("connectionNotice", () => {
	it("states Gmail's full grant in the platform's wording, and what the app does", () => {
		const notice = connectionNotice("gmail", "Gmail");
		expect(notice).toBe(
			"Connecting gives this app full access to your Gmail: it can read, send and delete mail, and it can see your profile and contacts. This app only reads mail threads onto the CRM records they belong to.",
		);
	});

	it("covers this install's Google connection: Gmail and Calendar grants together", () => {
		const notice = connectionNotice("google", "Google Workspace");
		expect(notice).toContain("full access to your Gmail");
		expect(notice).toContain("access to your Google Calendar");
		expect(notice).toContain("This app only reads mail threads and meetings");
	});

	it("says may for a connector whose grant is not known yet", () => {
		const notice = connectionNotice("outlook", "Microsoft 365");
		expect(notice).toBe(
			"Connecting may give this app full access to your Microsoft 365 account. This app uses it only for the features described on this page.",
		);
	});

	it("falls back to may for any app the map does not know", () => {
		const notice = connectionNotice("some-new-connector", "Some New Connector");
		expect(notice).toBe(
			"Connecting may give this app full access to your Some New Connector account. This app uses it only for the features described on this page.",
		);
	});

	it("never describes a connection as read-only", () => {
		for (const slug of [
			"gmail",
			"google",
			"googlecalendar",
			"googledrive",
			"slack",
			"hubspot",
			"notion",
			"outlook",
			"microsoft",
			"some-new-connector",
		]) {
			expect(connectionNotice(slug, "App").toLowerCase()).not.toContain(
				"read-only",
			);
			expect(MARKUP(slug, "App").toLowerCase()).not.toContain("read-only");
		}
	});

	it("renders the notice before the redirect: the sentence is on the connect screen's markup", () => {
		const markup = MARKUP("google", "Google Workspace");
		expect(markup).toContain("Connecting gives this app");
		expect(markup).toContain("This app only");
	});
});
