import { expect, it } from "bun:test";
import { FakePramaan } from "@crm/pramaan/fake";
import {
	type Person,
	publicHandles,
	verifyGithub,
	verifyX,
} from "../agent/lib/socials";

const person: Person = {
	firstName: "Sam",
	lastName: "Example",
	fullName: "Sam Example",
	title: null,
	companyName: "Example",
	companyDomain: "example.test",
};
it("accepts only a linked verified handle and keeps the evidence", async () => {
	const api = new FakePramaan();
	api.routeOutcomes({
		get: () => ({ available: true }),
		estimate: () => ({
			canRun: true,
			plan: "social",
			steps: [],
			priceMinMicro: 1,
			priceMaxMicro: 2,
		}),
		run: () => ({
			status: "done",
			completeness: "partial",
			result: {
				handles: [
					{
						network: "github",
						handle: "samexample",
						url: "https://github.com/samexample",
						verified: true,
						evidence: ["dev: linked from established profile"],
					},
					{
						network: "x",
						handle: "samexample",
						url: "https://x.com/samexample",
						verified: false,
						evidence: ["social: unlinked suggestion"],
					},
				],
			},
			missing: [{ field: "x" }],
		}),
	});
	await publicHandles(person, {}, api);
	const result = await publicHandles(
		person,
		{ confirm: true, plan: "social" },
		api,
	);
	expect(result.state).toBe("done");
	const github = await verifyGithub(
		{
			network: "github",
			handle: "samexample",
			url: "https://github.com/samexample",
		},
		person,
	);
	expect(github.accepted).toBe(true);
	if (github.accepted) expect(github.evidence[0].detail).toContain("dev:");
	expect(
		(
			await verifyX(
				{ network: "x", handle: "samexample", url: "https://x.com/samexample" },
				person,
			)
		).accepted,
	).toBe(false);
	expect(
		(
			await verifyGithub(
				{
					network: "github",
					handle: "someoneelse",
					url: "https://github.com/someoneelse",
				},
				person,
			)
		).accepted,
	).toBe(false);
	expect(api.calls).toHaveLength(0);
});
