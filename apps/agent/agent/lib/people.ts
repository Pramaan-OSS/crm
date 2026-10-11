// People enrichment through Pramaan: a person read back from a LinkedIn URL you already hold,
// or from a work email plus clues. The `Person` shape callers know is kept; the enrichment
// itself is flatter than it used to be, so roles, schooling and avatars come back empty unless
// another source filled them.

import type { Caps } from "@crm/pramaan";
import { PramaanError } from "@crm/pramaan";
import { describe, PramaanLookupError } from "./context";
import { CONTEXT } from "./context-config";
import { pramaan } from "./pramaan";

export const MATCH_FLOOR = CONTEXT.people.matchFloor;

export type Organisation = {
	name: string | null;
	domain: string | null;
};

export type Role = {
	title: string | null;
	organisation: Organisation;
	startDate: string | null;
	endDate: string | null;
	location: string | null;
	description: string | null;
	isCurrent: boolean;
};

export type Study = {
	institution: Organisation;
	degree: string | null;
	fieldOfStudy: string | null;
	startDate: string | null;
	endDate: string | null;
};

export type Person = {
	firstName: string | null;
	lastName: string | null;
	fullName: string | null;
	bio: string | null;
	location: string | null;
	email: string | null;
	photoUrl: string | null;
	profileUrl: string | null;
	socialUrls: string[];
	websiteUrls: string[];
	skills: string[];
	currentRoles: Role[];
	experience: Role[];
	education: Study[];
};

export type PersonMatch =
	| { outcome: "found"; person: Person }
	| { outcome: "skipped"; reason: string }
	| { outcome: "failed"; reason: string; retryable: boolean };

export async function personByProfileUrl(
	profileUrl: string,
): Promise<PersonMatch> {
	const api = pramaan();
	if (!api) {
		return { outcome: "skipped", reason: "Pramaan is not configured." };
	}

	try {
		const response = await api.peopleEnrich({ linkedinUrl: profileUrl });
		return personFrom(response, profileUrl);
	} catch (error) {
		return classify(error);
	}
}

export type IdentityClues = {
	email: string;
	firstName: string | null;
	lastName: string | null;
	companyName: string | null;
	companyDomain: string | null;
};

export async function personByClues(
	clues: IdentityClues,
): Promise<PersonMatch> {
	const api = pramaan();
	if (!api) {
		return { outcome: "skipped", reason: "Pramaan is not configured." };
	}

	try {
		const response = await api.peopleEnrich({
			email: clues.email,
			firstName: clues.firstName || undefined,
			lastName: clues.lastName || undefined,
			domain: clues.companyDomain || undefined,
		});
		return personFrom(response, null);
	} catch (error) {
		return classify(error);
	}
}

export function personFrom(
	response: Caps.PeopleEnrichResult,
	profileUrl: string | null,
): PersonMatch {
	const fullName = response.fullName?.trim();
	if (!fullName) {
		return { outcome: "skipped", reason: "No person matched that profile." };
	}

	const linkedin = response.linkedinUrl ?? profileUrl;
	const socialUrls = linkedin ? [linkedin] : [];

	const person: Person = {
		firstName: response.firstName ?? null,
		lastName: response.lastName ?? null,
		fullName,
		bio: null,
		location: placeOf(response.location),
		email: null,
		photoUrl: null,
		profileUrl: linkedin ?? null,
		socialUrls,
		websiteUrls: [],
		skills: [],
		currentRoles: response.title
			? [
					{
						title: response.title,
						organisation: {
							name: response.company?.name ?? null,
							domain: response.company?.domain ?? null,
						},
						startDate: null,
						endDate: null,
						location: placeOf(response.location),
						description: null,
						isCurrent: true,
					},
				]
			: [],
		experience: [],
		education: [],
	};

	return { outcome: "found", person };
}

function classify(cause: unknown): PersonMatch {
	const reason = describe(cause);

	if (cause instanceof PramaanLookupError) {
		return { outcome: cause.outcome, reason, retryable: cause.retryable };
	}

	if (cause instanceof PramaanError) {
		if (cause.code === "invalid_request" || cause.code === "not_found") {
			return { outcome: "skipped", reason: "No person matched that profile." };
		}
		if (cause.code === "unauthorized") {
			return { outcome: "failed", reason, retryable: false };
		}
		return { outcome: "failed", reason, retryable: cause.retryable };
	}

	return { outcome: "failed", reason, retryable: true };
}

function placeOf(location: Caps.PeopleEnrichResult["location"]): string | null {
	if (!location) return null;
	const parts = [location.city, location.region, location.country].flatMap(
		(part) => (part ? [part] : []),
	);

	return parts.length > 0 ? parts.join(", ") : null;
}

export function photoUrl(raw: string | null): string | null {
	if (!raw) return null;

	try {
		const url = new URL(raw.trim());
		return url.protocol === "https:" ? url.toString() : null;
	} catch {
		return null;
	}
}

export function slugFromProfileUrl(raw: string | null): string | null {
	if (!raw) return null;

	try {
		const url = new URL(raw.trim());

		const host = url.hostname.toLowerCase();
		if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;

		const [section, slug] = url.pathname.split("/").filter(Boolean);
		if (section !== "in" || !slug) return null;

		return decodeURIComponent(slug);
	} catch {
		return null;
	}
}
