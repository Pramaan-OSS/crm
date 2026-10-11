// What this install can do, decided by one thing: is a Pramaan key set? Each entry names a
// place the agent can look and the capability that answers. No per-vendor keys remain.

import { Cap, type Pramaan } from "@crm/pramaan";
import { pramaan, pramaanEnabled } from "./pramaan";

export const RESEARCH = "web-research";

export const PEOPLE = "people";

export type Capability = {
	readonly id: string;
	readonly label: string;
	readonly gives: string;
	readonly enabled: boolean;
	readonly from: string;
};

/** True when this install has a Pramaan key, so every capability is on. */
export function connected(): boolean {
	return pramaanEnabled();
}

export async function capabilities(): Promise<readonly Capability[]> {
	return capabilitiesFrom(pramaan());
}

export function capabilitiesFrom(api: Pramaan | null): readonly Capability[] {
	const on = api !== null;

	return [
		{
			id: RESEARCH,
			from: "Pramaan",
			label: "Web research",
			gives:
				"open-web context with citations, and the search that finds a LinkedIn slug in the first place",
			enabled: on && Boolean(api?.info(Cap.webAnswers)),
		},
		{
			id: "companies",
			from: "Pramaan",
			label: "Company brand data",
			gives: "a company's logo, industry, location and socials from its domain",
			enabled: on && Boolean(api?.info(Cap.companiesEnrich)),
		},
		{
			id: PEOPLE,
			from: "Pramaan",
			label: "LinkedIn",
			gives:
				"a person read back from a LinkedIn URL you already hold — their real name, bio, current title and employer, every earlier role with its dates, their education and their other public profiles, all self-reported and so authoritative on identity",
			enabled: on && Boolean(api?.info(Cap.peopleEnrich)),
		},
		{
			id: "storage",
			from: "Pramaan",
			label: "Picture storage",
			gives:
				"somewhere to keep a logo or a profile photo. Without it a record has no picture at all, because the URLs these sources hand back expire and are never stored as they are",
			enabled: on && Boolean(api?.info(Cap.storageObjectUploadUrl)),
		},
	];
}

export async function enabled(id: string): Promise<boolean> {
	return (await capabilities()).some(
		(capability) => capability.id === id && capability.enabled,
	);
}

export type UnavailableCapability = {
	ok: false;
	configured: false;
	reason: string;
};

export function unavailable(capability: string): UnavailableCapability {
	return {
		ok: false,
		configured: false,
		reason:
			`This install has no Pramaan key, so ${capability} is unavailable. This is not a failure and retrying will not help — ` +
			"use what the CRM already knows, and say in your write-up what you could not check.",
	};
}

export async function logCapabilities(): Promise<void> {
	const list = await capabilities();

	for (const capability of list) {
		console.log(
			`[agent] ${capability.label}: ${capability.enabled ? "on" : "off"} — ${capability.gives}`,
		);
	}

	if (!list.some((capability) => capability.enabled)) {
		console.log(
			"[agent] Set PRAMAAN_API_KEY to turn these on. The agent runs without them, and says what it could not check.",
		);
	}

	console.log(
		"[agent] Note: the research runs themselves need a tool-capable model, which no Pramaan capability serves yet. Until one exists, agent runs report that they cannot start.",
	);
}

/** The capability list as markdown, for the agent's opening brief. */
export async function capabilitiesMarkdown(): Promise<string> {
	return markdownFor(await capabilities());
}

export function markdownFor(list: readonly Capability[]): string {
	const lines = list.map(
		(capability) =>
			`- **${capability.label}** — ${capability.enabled ? "available" : "not configured on this install"}. ${capability.gives}.`,
	);

	const off = list.filter((capability) => !capability.enabled).length;

	return [
		"## What this install can look up",
		...(off === list.length
			? [
					"No outside sources are configured, so work from the CRM alone (read_crm_history and the record tools).",
				]
			: []),
		...lines,
		...(off > 0
			? [
					"Where a source is not configured here, say so in your write-up instead of guessing.",
				]
			: []),
	].join("\n");
}
