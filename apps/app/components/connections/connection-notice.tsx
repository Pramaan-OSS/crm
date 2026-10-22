"use client";

// What a connector is granted, in one place, keyed by app slug. The platform's
// connector asks for broad access and a template cannot narrow it, so every
// connect surface states the grant plainly — and what this app does with it —
// before the person leaves for the hosted connect link. Never say a connection
// is read-only: the grant is broader than what this app does with it.

const KNOWN: ReadonlyMap<
	string,
	{ readonly granted: string; readonly appDoes: string }
> = new Map([
	[
		"gmail",
		{
			granted:
				"full access to your Gmail: it can read, send and delete mail, and it can see your profile and contacts",
			appDoes: "reads mail threads onto the CRM records they belong to",
		},
	],
	[
		"googlecalendar",
		{
			granted: "access to your Google Calendar: it can read and change events",
			appDoes: "reads meetings onto CRM records",
		},
	],
	[
		"googledrive",
		{
			granted:
				"full access to your Google Drive: it can read, change, share and delete files",
			appDoes: "reads only the files you pick",
		},
	],
	[
		"slack",
		{
			granted:
				"access to your Slack workspace: it can read and change channels and messages",
			appDoes: "posts agent updates where a deployed agent says to",
		},
	],
	[
		"hubspot",
		{
			granted:
				"access to your HubSpot account: it can read and change your records there",
			appDoes: "reads and updates the records a deployed agent works on",
		},
	],
	[
		"notion",
		{
			granted: "access to the Notion pages you pick in Notion's own picker",
			appDoes: "reads those pages",
		},
	],
]);

/** This install's two connections share one grant per provider. */
const CONNECTION_ALIASES: Record<string, string> = {
	google: "gmail+googlecalendar",
	googleworkspace: "gmail+googlecalendar",
	microsoft: "outlook",
	microsoft365: "outlook",
};

function normalize(slug: string): string {
	return slug.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function grantFor(
	slug: string,
):
	| { readonly granted: string; readonly appDoes: string }
	| { readonly may: true } {
	const key = normalize(slug);
	const aliased = CONNECTION_ALIASES[key];
	const target = aliased ?? key;

	if (target === "gmail+googlecalendar") {
		return {
			granted:
				"full access to your Gmail: it can read, send and delete mail and it can see your profile and contacts, and access to your Google Calendar: it can read and change events",
			appDoes:
				"reads mail threads and meetings onto the CRM records they belong to",
		};
	}
	const known = KNOWN.get(target);
	if (known) return known;
	// Not yet known: the connector may request full access, so say "may".
	return { may: true };
}

/**
 * The plain sentence for a connect screen: what the connector is granted, and what
 * this app does with it. Null when the slug names nothing (no notice to show).
 */
export function connectionNotice(slug: string, appName: string): string {
	const found = grantFor(slug);
	if ("may" in found) {
		return `Connecting may give this app full access to your ${appName} account. This app uses it only for the features described on this page.`;
	}
	return `Connecting gives this app ${found.granted}. This app only ${found.appDoes}.`;
}

/** The sentence, rendered on the connect screen before the redirect happens. */
export function ConnectionNotice({
	slug,
	appName,
}: {
	readonly slug: string;
	readonly appName: string;
}) {
	return (
		<p className="text-xs leading-relaxed text-muted-foreground">
			{connectionNotice(slug, appName)}
		</p>
	);
}
