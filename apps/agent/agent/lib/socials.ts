import {
	type OutcomeApproval,
	type Pramaan,
	runOutcomeFlow,
} from "@crm/pramaan";
import { z } from "zod";
import type { Evidence } from "./evidence";
import { pramaan } from "./pramaan";

export type Network = "x" | "github";

export type SocialProfile = {
	network: Network;
	handle: string;
	url: string;
};

export type Person = {
	email?: string | null;
	firstName: string;
	lastName: string | null;
	fullName: string;
	title: string | null;
	companyName: string | null;
	companyDomain: string | null;
};

export type Verdict =
	| { accepted: true; profile: SocialProfile; evidence: Evidence[] }
	| { accepted: false; reason: string };

const X_HOSTS = new Set([
	"x.com",
	"www.x.com",
	"twitter.com",
	"www.twitter.com",
	"mobile.twitter.com",
]);

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

const X_RESERVED = new Set([
	"i",
	"home",
	"explore",
	"search",
	"settings",
	"notifications",
	"messages",
	"intent",
	"share",
	"hashtag",
	"status",
	"login",
	"signup",
	"about",
	"privacy",
	"tos",
	"compose",
]);

const GITHUB_RESERVED = new Set([
	"orgs",
	"organizations",
	"features",
	"about",
	"pricing",
	"topics",
	"collections",
	"sponsors",
	"marketplace",
	"settings",
	"login",
	"join",
	"signup",
	"enterprise",
	"apps",
	"explore",
	"trending",
	"security",
	"readme",
	"site",
	"contact",
	"search",
	"new",
	"notifications",
]);

const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const GITHUB_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export function parseSocialUrl(raw: string): SocialProfile | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	let url: URL;
	try {
		url = new URL(
			/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
		);
	} catch {
		return null;
	}

	const host = url.hostname.toLowerCase();
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length !== 1) return null;

	const handle = decodeURIComponent(segments[0] as string).replace(/^@/, "");

	if (X_HOSTS.has(host)) {
		if (X_RESERVED.has(handle.toLowerCase())) return null;
		if (!X_HANDLE.test(handle)) return null;
		return {
			network: "x",
			handle: handle.toLowerCase(),
			url: `https://x.com/${handle}`,
		};
	}

	if (GITHUB_HOSTS.has(host)) {
		if (GITHUB_RESERVED.has(handle.toLowerCase())) return null;
		if (!GITHUB_HANDLE.test(handle)) return null;
		return {
			network: "github",
			handle: handle.toLowerCase(),
			url: `https://github.com/${handle}`,
		};
	}

	return null;
}

export function extractSocialUrls(haystack: string[]): SocialProfile[] {
	const found: SocialProfile[] = [];

	for (const chunk of haystack) {
		for (const match of chunk.matchAll(
			/https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com|github\.com)\/[^\s"'<>)\]},]+/gi,
		)) {
			const profile = parseSocialUrl(match[0].replace(/[.,;:!?]+$/, ""));
			if (profile && !found.some((f) => f.url === profile.url)) {
				found.push(profile);
			}
		}
	}

	return found;
}

const handleSchema = z.object({
	network: z.enum(["linkedin", "x", "github"]),
	handle: z.string(),
	url: z.string(),
	verified: z.boolean(),
	evidence: z.array(z.string()),
});
const cache = new Map<
	string,
	{ until: number; handles: z.infer<typeof handleSchema>[] }
>();
const personKey = (person: Person) => JSON.stringify(person);

export async function publicHandles(
	person: Person,
	approval: OutcomeApproval = {},
	api: Pramaan | null = pramaan(),
) {
	if (!api)
		return {
			state: "unavailable" as const,
			reason: "Pramaan is not configured.",
		};
	const input = person.email
		? { email: person.email }
		: { name: person.fullName, companyDomain: person.companyDomain };
	const attempt = await runOutcomeFlow(
		api,
		"person.public.brief",
		input,
		{},
		approval,
	);
	if (attempt.state !== "done") return attempt;
	const parsed = z
		.object({ handles: z.array(handleSchema).max(3).optional() })
		.safeParse(attempt.report.result);
	const handles = parsed.success ? (parsed.data.handles ?? []) : [];
	cache.set(personKey(person), { until: Date.now() + 15 * 60_000, handles });
	return { ...attempt, handles };
}

async function verifyReturned(
	profile: SocialProfile,
	person: Person,
): Promise<Verdict> {
	const saved = cache.get(personKey(person));
	if (!saved || saved.until <= Date.now()) {
		cache.delete(personKey(person));
		return {
			accepted: false,
			reason: "Request and approve a fresh public profile lookup first.",
		};
	}
	const rows = saved.handles.filter((row) => row.network === profile.network);
	const row = rows.length === 1 ? rows[0] : undefined;
	const parsed = row && parseSocialUrl(row.url);
	if (
		!row?.verified ||
		!row.evidence.length ||
		!parsed ||
		parsed.handle !== profile.handle ||
		parsed.network !== profile.network ||
		row.handle.toLowerCase().replace(/^@/, "") !== parsed.handle
	)
		return {
			accepted: false,
			reason: "This handle has no verified link to the established person.",
		};
	return {
		accepted: true,
		profile: parsed,
		evidence: row.evidence.map((detail) => ({
			kind: "public-profile.link",
			detail,
			sourceUrl: parsed.url,
		})),
	};
}
export const verifyGithub = verifyReturned;
export const verifyX = verifyReturned;

/** Read already checked candidates without making another paid request. */
export async function findSocialCandidates(person: Person, network: Network) {
	const saved = cache.get(personKey(person));
	const rows =
		saved && saved.until > Date.now()
			? saved.handles.filter((row) => row.network === network)
			: [];
	return {
		candidates: rows.flatMap((row) => {
			const parsed = parseSocialUrl(row.url);
			return parsed ? [parsed] : [];
		}),
		citations: rows.flatMap((row) => row.evidence),
	};
}
