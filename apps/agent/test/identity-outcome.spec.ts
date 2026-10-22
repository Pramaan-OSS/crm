import { expect, it } from "bun:test";
import { identityComparison } from "../agent/lib/identity-outcome";

it("requires independent matching keys and evidence before identity can be confirmed", () => {
	const record = {
		matchedKeys: ["linkedinUrl"],
		conflictingKeys: [],
		evidence: ["identify[0]", "phone"],
	};
	expect(identityComparison({ ...record, verdict: "same" }).isSamePerson).toBe(
		true,
	);
	for (const verdict of ["unsure", "different"])
		expect(identityComparison({ ...record, verdict }).isSamePerson).toBe(false);
	expect(
		identityComparison({ ...record, verdict: "same", matchedKeys: [] })
			.isSamePerson,
	).toBe(false);
	expect(
		identityComparison({
			...record,
			verdict: "same",
			conflictingKeys: ["email"],
		}).isSamePerson,
	).toBe(false);
	expect(
		identityComparison({ ...record, verdict: "same", evidence: [] })
			.isSamePerson,
	).toBe(false);
	expect(identityComparison(undefined).isSamePerson).toBe(false);
});
