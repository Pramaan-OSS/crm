// The capabilities this product uses, with the traits the client needs offline: which are
// read_only (safe to retry) and which run as async jobs. Ids are real; see the capabilities
// catalogue. Effect classes per capability:
//
//   read_only                web.*  companies.*  people.*  finance.exchange-rate.get  llm.*
//   external_reversible      apps.connection.start, storage.object.*
//   external_irreversible    apps.action.execute, apps.connection.revoke, email.send

import type { CapabilityInfo } from "./sdk/types";

export const CATALOG = {
	"web.search": {
		id: "web.search",
		description: "Search the web; returns titles, URLs, snippets and dates.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"web.answers": {
		id: "web.answers",
		description: "Research the web for a task and return a sourced answer.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"web.read": {
		id: "web.read",
		description: "Read one web page as clean text.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"web.extract": {
		id: "web.extract",
		description: "Extract structured JSON data from one web page.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"web.page.metadata": {
		id: "web.page.metadata",
		description: "Read a page's metadata, such as its title and description.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"companies.enrich": {
		id: "companies.enrich",
		description: "Company profile from a domain, name or LinkedIn URL.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"companies.news": {
		id: "companies.news",
		description: "Recent news about a company, from its domain.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"people.enrich": {
		id: "people.enrich",
		description:
			"Professional profile from a work email, a LinkedIn URL, or a name plus domain.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"people.dev.profiles.find": {
		id: "people.dev.profiles.find",
		description:
			"Find public developer accounts linked to a person's public profile.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"people.email.verify": {
		id: "people.email.verify",
		description: "Check that an email address is real and accepts mail.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"finance.exchange-rate.get": {
		id: "finance.exchange-rate.get",
		description: "The latest reference exchange rate between two currencies.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"llm.complete": {
		id: "llm.complete",
		description: "Generate a text reply to a chat of messages.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"apps.catalog.search": {
		id: "apps.catalog.search",
		description: "Discover one page of connected-app actions.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"document.parse": {
		id: "document.parse",
		description: "Read a platform file as text.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"storage.object.upload-url": {
		id: "storage.object.upload-url",
		description: "Create a short-lived signed URL that uploads one file.",
		effectClass: "external_reversible",
		mode: "sync",
		needsConnection: false,
	},
	"storage.object.download-url": {
		id: "storage.object.download-url",
		description: "Create a short-lived signed URL that downloads one file.",
		effectClass: "external_reversible",
		mode: "sync",
		needsConnection: false,
	},
	"apps.connection.start": {
		id: "apps.connection.start",
		description:
			"Start connecting an end user to a third-party app; returns a hosted sign-in link.",
		effectClass: "external_reversible",
		mode: "sync",
		needsConnection: false,
	},
	"apps.connections.list": {
		id: "apps.connections.list",
		description:
			"List one end user's third-party app connections and their status.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
	"apps.connection.revoke": {
		id: "apps.connection.revoke",
		description:
			"Disconnect one end user from a third-party app and revoke its access.",
		effectClass: "external_irreversible",
		mode: "sync",
		needsConnection: false,
	},
	"apps.action.execute": {
		id: "apps.action.execute",
		description:
			"Run one action in a connected third-party app as one of your end users.",
		effectClass: "external_irreversible",
		mode: "sync",
		needsConnection: false,
	},
	"email.send": {
		id: "email.send",
		description: "Send an email.",
		effectClass: "external_irreversible",
		mode: "sync",
		needsConnection: false,
	},
	"auth.backend.provision": {
		id: "auth.backend.provision",
		description:
			"Open a managed sign-in backend for your app, with no auth account of your own; calling again returns the same one.",
		effectClass: "external_reversible",
		mode: "sync",
		needsConnection: false,
	},
	"auth.backend.get": {
		id: "auth.backend.get",
		description:
			"Read the status and settings of your app's managed sign-in backend: its URLs, social providers and allowed domains.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: true,
	},
	"auth.backend.domains.set": {
		id: "auth.backend.domains.set",
		description:
			"Set the origins users may be sent back to after signing in on your app's managed sign-in backend (replaces the list).",
		effectClass: "external_reversible",
		mode: "sync",
		needsConnection: true,
	},
	"auth.token.verify": {
		id: "auth.token.verify",
		description:
			"Check a signed-in user's session token against your auth system's public keys; returns who it is for.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: true,
	},
	"auth.user.get": {
		id: "auth.user.get",
		description: "Get one user of your managed sign-in backend by id.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: true,
	},
	"auth.users.list": {
		id: "auth.users.list",
		description: "List the users of your managed sign-in backend, matching email or name.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: true,
	},
	"auth.user.delete": {
		id: "auth.user.delete",
		description: "Delete one user of your managed sign-in backend, permanently.",
		effectClass: "external_irreversible",
		mode: "sync",
		needsConnection: true,
	},
	"db.postgres.provision": {
		id: "db.postgres.provision",
		description:
			"Open or restore your project's managed Postgres database. Connection addresses are shown once when created; a new key returns an existing database without secrets.",
		effectClass: "external_reversible",
		mode: "sync",
		needsConnection: false,
	},
	"db.postgres.get": {
		id: "db.postgres.get",
		description:
			"Get the state and limits of your project's managed Postgres database; never returns a connection address or password.",
		effectClass: "read_only",
		mode: "sync",
		needsConnection: false,
	},
} satisfies Record<string, CapabilityInfo>;

const BY_ID = new Map<string, CapabilityInfo>(Object.entries(CATALOG));

/** Traits of one capability this product uses, or undefined for any other id. */
export function capabilityInfo(id: string): CapabilityInfo | undefined {
	return BY_ID.get(id);
}
