import { describe, expect, it } from "bun:test";
import type { Caps } from "@crm/pramaan";
import { personFrom } from "../agent/lib/people";

const PROFILE = "https://www.linkedin.com/in/paulamarchetti";

const ENRICHED: Caps.PeopleEnrichResult = {
	fullName: "Paula Marchetti",
	firstName: "Paula",
	lastName: "Marchetti",
	title: "Head of Revenue",
	company: { name: "Fernhill", domain: "fernhill.com" },
	location: { city: "Milan", country: "Italy" },
	linkedinUrl: PROFILE,
};

function found(result: ReturnType<typeof personFrom>) {
	expect(result.outcome).toBe("found");
	if (result.outcome !== "found") throw new Error("not found");
	return result.person;
}

describe("reading a person out of an enrichment", () => {
	it("carries the name, the title and the employer", () => {
		const person = found(personFrom(ENRICHED, PROFILE));

		expect(person.firstName).toBe("Paula");
		expect(person.lastName).toBe("Marchetti");
		expect(person.fullName).toBe("Paula Marchetti");
		expect(person.currentRoles).toHaveLength(1);
		expect(person.currentRoles[0]?.title).toBe("Head of Revenue");
		expect(person.currentRoles[0]?.organisation.domain).toBe("fernhill.com");
		expect(person.currentRoles[0]?.isCurrent).toBe(true);
	});

	it("takes the enrichment's LinkedIn URL as the profile", () => {
		const person = found(personFrom(ENRICHED, null));

		expect(person.profileUrl).toBe(PROFILE);
		expect(person.socialUrls).toEqual([PROFILE]);
	});

	it("keeps the URL the caller came in with when the enrichment has none", () => {
		const person = found(
			personFrom({ ...ENRICHED, linkedinUrl: undefined }, PROFILE),
		);

		expect(person.profileUrl).toBe(PROFILE);
	});

	it("has no profile at all when nothing points anywhere", () => {
		const person = found(
			personFrom({ ...ENRICHED, linkedinUrl: undefined }, null),
		);

		expect(person.profileUrl).toBe(null);
		expect(person.socialUrls).toEqual([]);
	});

	it("reads the place back as one line", () => {
		const person = found(personFrom(ENRICHED, PROFILE));

		expect(person.location).toBe("Milan, Italy");
	});

	it("leaves the deeper facts empty rather than guessing", () => {
		const person = found(personFrom(ENRICHED, PROFILE));

		expect(person.bio).toBeNull();
		expect(person.photoUrl).toBeNull();
		expect(person.experience).toEqual([]);
		expect(person.education).toEqual([]);
		expect(person.skills).toEqual([]);
	});
});

describe("when the enrichment matches nobody", () => {
	it("is skipped when no name comes back", () => {
		const result = personFrom({ ...ENRICHED, fullName: "" }, PROFILE);

		expect(result.outcome).toBe("skipped");
	});
});
