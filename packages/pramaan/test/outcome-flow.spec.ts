import { describe, expect, it } from "bun:test";
import { FakePramaan } from "../src/fake";
import { PramaanError } from "../src/index";
import { runOutcomeFlow } from "../src/outcome-flow";

for (const [id, input, options] of [
	["auth.backend.setup", { domains: ["http://localhost:3000"] }, {}],
	[
		"company.brand.kit",
		{ domain: "example.test" },
		{ storeLogo: true },
	],
	[
		"person.public.brief",
		{ name: "Sam Example", companyDomain: "example.test" },
		{},
	],
	[
		"meeting.brief",
		{ domain: "example.test", privateContext: "Caller notes" },
		{ brief: true, news: true, posts: false },
	],
	["contact.identify", { email: "sam@example.test" }, {}],
	["lead.identity.resolve", { email: "sam@example.test" }, { company: true }],
] as const)
	describe(id, () => {
		const make = () => {
			const fake = new FakePramaan();
			fake.routeOutcomes({
				get: () => ({ available: true }),
				estimate: () => ({
					canRun: true,
					plan: `plan-${id}`,
					requiresApproval: true,
					priceMinMicro: 1,
					priceTypicalMicro: 2,
					priceMaxMicro: 3,
					steps: [{ label: "Read and check" }],
				}),
				run: () => ({
					status: "done",
					completeness: "complete",
					result: { checked: true },
					missing: [],
					evidence: {},
					steps: [],
				}),
			});
			return fake;
		};
		it("estimates exact options, then runs only the approved request", async () => {
			const fake = make();
			const estimate = await runOutcomeFlow(fake, id, input, options);
			expect(estimate.state).toBe("estimate");
			expect(fake.outcomeCalls.some((c) => c.verb === "run")).toBe(false);
			expect(fake.outcomeCalls[1].opts?.options).toEqual(options);
			const done = await runOutcomeFlow(fake, id, input, options, {
				confirm: true,
				plan: `plan-${id}`,
			});
			expect(done.state).toBe("done");
			expect(fake.outcomeCalls.at(-1)?.opts?.plan).toBe(`plan-${id}`);
		});
		it("preserves partial evidence without retrying", async () => {
			const fake = make();
			fake.routeOutcomes({
				run: () => ({
					status: "done",
					completeness: "partial",
					missing: [{ field: "optional" }],
					result: {},
					evidence: { source: "checked" },
				}),
			});
			await runOutcomeFlow(fake, id, input, options);
			const result = await runOutcomeFlow(fake, id, input, options, {
				confirm: true,
				plan: `plan-${id}`,
			});
			expect(result.state === "done" && result.report.completeness).toBe(
				"partial",
			);
			expect(fake.outcomeCalls.filter((c) => c.verb === "run")).toHaveLength(1);
		});
		it("handles approval_required and refusal with no paid fallback", async () => {
			const fake = make();
			fake.routeOutcomes({
				run: () => {
					throw new PramaanError("forbidden", "approval_required");
				},
			});
			await runOutcomeFlow(fake, id, input, options);
			expect(
				(
					await runOutcomeFlow(fake, id, input, options, {
						confirm: true,
						plan: `plan-${id}`,
					})
				).state,
			).toBe("refused");
			expect(fake.calls).toHaveLength(0);
		});
		it("does not estimate or run an unavailable outcome", async () => {
			const fake = make();
			fake.routeOutcomes({ get: () => ({ available: false }) });
			expect((await runOutcomeFlow(fake, id, input, options)).state).toBe(
				"unavailable",
			);
			expect(fake.outcomeCalls).toHaveLength(1);
		});
		it("rejects changed inputs and expired approvals", async () => {
			const fake = make();
			await runOutcomeFlow(fake, id, input, options);
			expect(
				(
					await runOutcomeFlow(fake, id, { changed: true }, options, {
						confirm: true,
						plan: `plan-${id}`,
					})
				).state,
			).toBe("refused");
			const now = Date.now;
			Date.now = () => now() + 16 * 60_000;
			try {
				expect(
					(
						await runOutcomeFlow(fake, id, input, options, {
							confirm: true,
							plan: `plan-${id}`,
						})
					).state,
				).toBe("refused");
			} finally {
				Date.now = now;
			}
		});
	});
