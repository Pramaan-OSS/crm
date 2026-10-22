import { describe, expect, test } from "bun:test";
import { FakePramaan } from "@crm/pramaan/fake";

import {
	companyResearchOutcome,
	formatOutcomeBrief,
} from "../agent/lib/company-research";

import {
	companyResearchPartialReport,
	companyResearchDefaultEstimate,
} from "../../../packages/pramaan/test/fixtures/company-research-partial";

const COMPANY = {
	name: "Example Co",
	domain: "example.com",
	website: "https://example.com",
};

const DESCRIPTION = {
	id: "company.research",
	description: "d",
	available: true,
};

const ESTIMATE = {
	outcome: "company.research",
	version: 1,
	plan: "plan_abc123",
	ready: true,
	canRun: true,
	priceMinMicro: 100,
	priceMaxMicro: 4200,
	balanceMicro: 5_000_000,
	steps: [
		{ id: "enrich", label: "Company profile", capability: "companies.enrich" },
	],
};

const REPORT = {
	outcome: "company.research",
	version: 1,
	plan: "plan_abc123",
	status: "done",
	completeness: "complete",
	result: {
		summary: "Sells developer tooling.",
		pricingModel: "Per seat.",
		targetCustomer: "Startups.",
		notableCustomers: ["Acme"],
		recentNews: ["Raised a round."],
	},
	evidence: {},
	missing: [],
	steps: [
		{
			id: "enrich",
			label: "Company profile",
			capability: "companies.enrich",
			effectClass: "read_only",
			status: "done",
			calls: 1,
			effect: "none",
		},
	],
	cost: { holdMicro: 4200, chargedMicro: 900, capabilities: [] },
};

function availableFake(report: unknown = REPORT) {
	const fake = new FakePramaan();
	fake.routeOutcomes({
		get: () => DESCRIPTION,
		estimate: () => ESTIMATE,
		run: () => report,
	});
	return fake;
}

describe("companyResearchOutcome", () => {
	test("without confirm it answers with the estimate for the person to approve", async () => {
		const fake = availableFake();
		const attempt = await companyResearchOutcome(fake, COMPANY);

		expect(attempt.via).toBe("needs-confirmation");
		if (attempt.via !== "needs-confirmation") return;
		expect(attempt.plan).toBe("plan_abc123");
		expect(attempt.priceMaxMicro).toBe(4200);
		expect(attempt.summary).toContain("Company profile");
		expect(attempt.summary).toContain("$0.0042");
		// Nothing ran: the fake recorded an estimate, never a run.
		expect(fake.outcomeCalls.some((call) => call.verb === "run")).toBe(false);
	});

	test("confirmed, it runs and maps the report into the brief", async () => {
		const fake = availableFake();
		const attempt = await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: "plan_abc123",
		});

		expect(attempt.via).toBe("outcome");
		if (attempt.via !== "outcome") return;
		expect(attempt.brief.positioning).toBe("Sells developer tooling.");
		expect(attempt.brief.pricingModel).toBe("Per seat.");
		expect(attempt.brief.notableCustomers).toEqual(["Acme"]);
		expect(attempt.meta.chargedMicro).toBe(900);
		expect(attempt.meta.completeness).toBe("complete");
	});

	test("news that does not name the company is dropped", async () => {
		const fake = availableFake({
			...REPORT,
			result: {
				...REPORT.result,
				name: "Linear",
				recentNews: ["Linear ships agents.", "Linux backdoor found."],
			},
		});
		const attempt = await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: "plan_abc123",
		});

		expect(attempt.via).toBe("outcome");
		if (attempt.via !== "outcome") return;
		expect(attempt.brief.recentNews).toEqual(["Linear ships agents."]);
	});

	test("available: false falls back to the capability path", async () => {
		const fake = new FakePramaan();
		fake.routeOutcomes({
			get: () => ({ ...DESCRIPTION, available: false }),
		});
		const attempt = await companyResearchOutcome(fake, COMPANY);

		expect(attempt.via).toBe("unavailable");
		expect(fake.outcomeCalls.some((call) => call.verb === "run")).toBe(false);
	});

	test("a run refused 502 upstream_unavailable is the fallback signal", async () => {
		const fake = availableFake({
			error: {
				code: "upstream_unavailable",
				message: "This outcome cannot run yet.",
			},
		});
		const fakeWithStatus = fake;
		// The fake's run route resolves; make it reject the way the client does on 502.
		fake.routeOutcomes({
			run: () => {
				const error = new Error("This outcome cannot run yet.");
				(error as { status?: number; code?: string }).status = 502;
				(error as { code?: string }).code = "upstream_unavailable";
				throw error;
			},
		});
		void fakeWithStatus;
		const attempt = await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: "plan_abc123",
		});

		expect(attempt.via).toBe("unavailable");
	});

	test("a paid start that times out is result-unknown, never failed", async () => {
		const fake = new FakePramaan();
		fake.routeOutcomes({
			get: () => DESCRIPTION,
			estimate: () => ESTIMATE,
			run: () => {
				const error = new Error("The gateway timed out.");
				(error as { status?: number; code?: string }).status = 504;
				(error as { code?: string }).code = "upstream_timeout";
				throw error;
			},
		});
		const attempt = await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: "plan_abc123",
			sessionRef: "sess_timeout",
		});

		expect(attempt.via).toBe("result-unknown");
		if (attempt.via !== "result-unknown") return;
		expect(attempt.reason).toBe(
			"Result unknown — the run may have started; check before retrying",
		);
	});

	test("a start whose request never gets a response is result-unknown too", async () => {
		const fake = new FakePramaan();
		fake.routeOutcomes({
			get: () => DESCRIPTION,
			estimate: () => ESTIMATE,
			run: () => {
				const error = new Error("Could not reach the Pramaan API.");
				(error as { code?: string }).code = "upstream_unavailable";
				throw error;
			},
		});
		const attempt = await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: "plan_abc123",
			sessionRef: "sess_network",
		});

		expect(attempt.via).toBe("result-unknown");
		if (attempt.via !== "result-unknown") return;
		expect(attempt.reason).toContain("check before retrying");
	});

	test("a result-unknown run is never re-run in the same session", async () => {
		const fake = new FakePramaan();
		fake.routeOutcomes({
			get: () => DESCRIPTION,
			estimate: () => ESTIMATE,
			run: () => {
				const error = new Error("The gateway timed out.");
				(error as { status?: number; code?: string }).status = 504;
				(error as { code?: string }).code = "upstream_timeout";
				throw error;
			},
		});
		const options = {
			confirm: true,
			plan: "plan_abc123",
			sessionRef: "sess_repeat",
		};
		const first = await companyResearchOutcome(fake, COMPANY, options);
		expect(first.via).toBe("result-unknown");
		const runsBefore = fake.outcomeCalls.filter((c) => c.verb === "run").length;
		const second = await companyResearchOutcome(fake, COMPANY, options);
		expect(second.via).toBe("result-unknown");
		expect(second).toBe(first);
		const runsAfter = fake.outcomeCalls.filter((c) => c.verb === "run").length;
		expect(runsAfter).toBe(runsBefore);
	});

	test("a manual retry after result-unknown uses a fresh estimate and a new idempotency key", async () => {
		const keys: (string | undefined)[] = [];
		const fake = new FakePramaan();
		fake.routeOutcomes({
			get: () => DESCRIPTION,
			estimate: () => ESTIMATE,
			run: (_id, _input, opts) => {
				keys.push(opts?.idempotencyKey);
				if (keys.length === 1) {
					const error = new Error("The gateway timed out.");
					(error as { status?: number; code?: string }).status = 504;
					(error as { code?: string }).code = "upstream_timeout";
					throw error;
				}
				return REPORT;
			},
		});
		const sessionRef = "sess_manual_retry";
		const options = { confirm: true, plan: "plan_abc123", sessionRef };

		const first = await companyResearchOutcome(fake, COMPANY, options);
		expect(first.via).toBe("result-unknown");

		const fresh = await companyResearchOutcome(fake, COMPANY, {
			sessionRef,
			retry: true,
		});
		expect(fresh.via).toBe("needs-confirmation");
		if (fresh.via !== "needs-confirmation") return;
		const retried = await companyResearchOutcome(fake, COMPANY, {
			sessionRef,
			confirm: true,
			plan: fresh.plan,
			retryToken: fresh.retryToken,
		});
		expect(retried.via).toBe("outcome");
		expect(keys.length).toBe(2);
		expect(keys[0]).not.toEqual(keys[1]);
	});

	test("a run that failed midway is reported, not retried", async () => {
		const fake = availableFake({
			outcome: "company.research",
			version: 1,
			plan: "plan_abc123",
			status: "failed",
			error: { message: "A required step failed." },
			steps: [],
			cost: { holdMicro: 4200, chargedMicro: 100, capabilities: [] },
		});
		const attempt = await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: "plan_abc123",
		});

		expect(attempt.via).toBe("failed");
		if (attempt.via !== "failed") return;
		expect(attempt.reason).toContain("Check what completed");
	});
});

describe("long research decisions", () => {
	test("429 says try later and does not use the capability fallback", async () => {
		const fake = availableFake();
		fake.routeOutcomes({
			run: () => {
				throw Object.assign(new Error("busy"), { status: 429 });
			},
		});
		const result = await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: ESTIMATE.plan,
		});
		expect(result.via).toBe("failed");
		if (result.via === "failed") expect(result.reason).toContain("Try later");
		expect(
			fake.outcomeCalls.filter((call) => call.verb === "run"),
		).toHaveLength(1);
		expect(fake.calls).toHaveLength(0);
	});
	test("unknown effects require checking and block a repeated session attempt", async () => {
		const fake = availableFake({
			...REPORT,
			status: "failed",
			steps: [{ ...REPORT.steps[0], effect: "unknown" }],
		});
		const options = {
			confirm: true,
			plan: ESTIMATE.plan,
			sessionRef: "session-one",
		};
		const result = await companyResearchOutcome(fake, COMPANY, options);
		expect(result.via).toBe("failed");
		if (result.via === "failed")
			expect(result.reason).toContain("Check before retrying");
		expect(await companyResearchOutcome(fake, COMPANY, options)).toEqual(
			result,
		);
		expect(
			fake.outcomeCalls.filter((call) => call.verb === "run"),
		).toHaveLength(1);
	});
	test("timeout reports remain failed rather than falling back", async () => {
		const fake = availableFake({
			...REPORT,
			status: "failed",
			error: { code: "upstream_timeout" },
		});
		const result = await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: ESTIMATE.plan,
		});
		expect(result.via).toBe("failed");
		if (result.via === "failed") expect(result.reason).toContain("time limit");
		expect(fake.calls).toHaveLength(0);
	});
	test("a failed read of an accepted job cannot start the fallback", async () => {
		const fake = availableFake();
		fake.routeOutcomes({
			run: () => {
				throw Object.assign(new Error("lost"), {
					code: "upstream_unavailable",
					status: 502,
					jobId: "accepted",
				});
			},
		});
		const result = await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: ESTIMATE.plan,
		});
		expect(result.via).toBe("failed");
		expect(fake.calls).toHaveLength(0);
	});
});

describe("owner-reported partial research", () => {
	const company = {
		name: "Stripe",
		domain: "stripe.com",
		website: "https://stripe.com",
	};
	function fakeReport() {
		const fake = new FakePramaan();
		fake.routeOutcomes({
			get: () => ({ ...DESCRIPTION, priceMaxMicro: 2168790 }),
			estimate: () => companyResearchDefaultEstimate,
			run: () => companyResearchPartialReport,
		});
		return fake;
	}
	test("estimate shows both input-specific prices, not the catalogue figure", async () => {
		const fake = fakeReport();
		const result = await companyResearchOutcome(fake, company);
		expect(result.via).toBe("needs-confirmation");
		if (result.via !== "needs-confirmation") return;
		expect(result.priceMinMicro).toBe(260000);
		expect(result.priceMaxMicro).toBe(597220);
		expect(result.summary).toContain("$0.260000–$0.597220");
		expect(result.summary).not.toContain("2.168790");
		expect(fake.outcomeCalls.filter((c) => c.verb === "run")).toHaveLength(0);
	});
	test("partial done keeps found fields, unmodified location, and actual charge", async () => {
		const result = await companyResearchOutcome(fakeReport(), company, {
			confirm: true,
			plan: "fixture_plan",
		});
		expect(result.via).toBe("outcome");
		if (result.via !== "outcome") return;
		const text = formatOutcomeBrief(result);
		expect(text).toContain("Research completeness: partial");
		expect(text).toContain("Payments infrastructure.");
		expect(text).toContain("Name: Stripe");
		expect(text).toContain("Industry: Financial services");
		expect(text).toContain("Employees: 8000");
		expect(text).toContain("Founded: 2010");
		expect(text).toContain(
			'Location: {"country":"San Francisco United States"}',
		);
		expect(text).toContain(
			"Company profile: https://www.linkedin.com/company/stripe",
		);
		expect(text).toContain("Actually charged: $0.015300");
		expect(text).not.toContain("$0.597220");
		expect(text).not.toContain("2.168790");
	});
	test("failed dependencies override misleading skipped-step missing details", async () => {
		const result = await companyResearchOutcome(fakeReport(), company, {
			confirm: true,
		});
		if (result.via !== "outcome") throw new Error("Expected partial brief");
		const text = formatOutcomeBrief(result);
		for (const label of [
			"Legal name",
			"Register number",
			"Register status",
			"Incorporated",
			"Registered address",
			"News",
			"Website",
			"Pricing",
			"Customers served",
			"Notable customers",
		])
			expect(text).toContain(`${label}: Source unavailable in this run.`);
		for (const label of ["Technologies", "Open roles", "Similar companies"])
			expect(text).toContain(`${label}: Not requested in this run.`);
		expect(text).not.toContain("No register entry");
		expect(text).not.toContain("no news");
		expect(text).not.toContain("no website");
	});
	test("skips without a failed dependency do not imply absence", async () => {
		const fake = fakeReport();
		fake.routeOutcomes({
			run: () => ({
				...companyResearchPartialReport,
				steps: companyResearchPartialReport.steps.filter(
					(s) => !["registry-search", "site-map"].includes(s.id),
				),
			}),
		});
		const result = await companyResearchOutcome(fake, company, {
			confirm: true,
		});
		if (result.via !== "outcome") throw new Error("Expected partial brief");
		const text = formatOutcomeBrief(result);
		expect(text).toContain("Legal name: Source was skipped; not checked.");
		expect(text).toContain("Website: Source was skipped; not checked.");
	});
	test("partial run is never repeated; manual retry only estimates until approved", async () => {
		const fake = fakeReport();
		const options = {
			confirm: true,
			plan: "fixture_plan",
			sessionRef: "fixture_session",
		};
		const first = await companyResearchOutcome(fake, company, options);
		expect(
			await companyResearchOutcome(fake, company, {
				...options,
				plan: "another_plan",
			}),
		).toEqual(first);
		expect(fake.outcomeCalls.filter((c) => c.verb === "run")).toHaveLength(1);
		const estimatesBefore = fake.outcomeCalls.filter(
			(c) => c.verb === "estimate",
		).length;
		const retry = await companyResearchOutcome(fake, company, {
			...options,
			retry: true,
		});
		if (retry.via !== "needs-confirmation")
			throw new Error("Expected fresh approval");
		expect(retry.retryToken).toBeDefined();
		expect(fake.outcomeCalls.filter((c) => c.verb === "estimate")).toHaveLength(
			estimatesBefore + 1,
		);
		expect(fake.outcomeCalls.filter((c) => c.verb === "run")).toHaveLength(1);
		const retried = await companyResearchOutcome(fake, company, {
			...options,
			retryToken: retry.retryToken,
			plan: retry.plan,
		});
		expect(retried.via).toBe("outcome");
		expect(fake.outcomeCalls.filter((c) => c.verb === "run")).toHaveLength(2);
		await companyResearchOutcome(fake, company, {
			...options,
			retryToken: retry.retryToken,
			plan: retry.plan,
		});
		expect(fake.outcomeCalls.filter((c) => c.verb === "run")).toHaveLength(2);
	});
	test("unapproved retry token cannot start a run", async () => {
		const fake = fakeReport();
		expect(
			(
				await companyResearchOutcome(fake, company, {
					confirm: true,
					retryToken: "not_approved",
					plan: "fixture_plan",
				})
			).via,
		).toBe("failed");
		expect(fake.outcomeCalls).toHaveLength(0);
	});
	for (const employeeRange of ["8000", "5001+"])
		test(`employee count text and bands are displayed as supplied: ${employeeRange}`, async () => {
			const fake = fakeReport();
			fake.routeOutcomes({
				run: () => ({
					...companyResearchPartialReport,
					result: { ...companyResearchPartialReport.result, employeeRange },
				}),
			});
			const result = await companyResearchOutcome(fake, company, {
				confirm: true,
			});
			if (result.via !== "outcome") throw new Error("Expected brief");
			expect(formatOutcomeBrief(result)).toContain(
				`Employees: ${employeeRange}`,
			);
		});
	test("revised unavailable wording and structured location remain unavailable and unmodified", async () => {
		const { companyResearchBandReport } = await import(
			"../../../packages/pramaan/test/fixtures/company-research-partial"
		);
		const fake = fakeReport();
		fake.routeOutcomes({ run: () => companyResearchBandReport });
		const result = await companyResearchOutcome(fake, company, {
			confirm: true,
		});
		if (result.via !== "outcome") throw new Error("Expected partial brief");
		const text = formatOutcomeBrief(result);
		expect(text).toContain("Employees: 5001+");
		expect(text).toContain(
			'Location: {"city":"Example City","country":"Example Country"}',
		);
		for (const label of [
			"Legal name",
			"Register number",
			"Register status",
			"Registered address",
			"News",
			"Website",
		])
			expect(text).toContain(`${label}: Source unavailable in this run.`);
		expect(text).not.toMatch(/no match|no register entry|no news|no website/i);
	});
});

test("failed step retries require a new approval even after a failed report", async () => {
	const fake = availableFake({
		...REPORT,
		status: "failed",
		steps: [{ ...REPORT.steps[0], status: "failed" }],
	});
	const options = {
		confirm: true,
		plan: ESTIMATE.plan,
		sessionRef: "failed-session",
	};
	const first = await companyResearchOutcome(fake, COMPANY, options);
	expect(first.via).toBe("failed");
	expect(
		await companyResearchOutcome(fake, COMPANY, {
			...options,
			plan: "changed",
		}),
	).toEqual(first);
	expect(fake.outcomeCalls.filter((c) => c.verb === "run")).toHaveLength(1);
	const approval = await companyResearchOutcome(fake, COMPANY, {
		...options,
		retry: true,
	});
	expect(approval.via).toBe("needs-confirmation");
	expect(fake.outcomeCalls.filter((c) => c.verb === "run")).toHaveLength(1);
});

	describe("fresh lookups on person-started runs", () => {
	test("a fresh session sends Pramaan-Fresh on the outcome run", async () => {
		const opts: (Record<string, unknown> | undefined)[] = [];
		const fake = new FakePramaan();
		fake.routeOutcomes({
			get: () => DESCRIPTION,
			estimate: () => ESTIMATE,
			run: (_id, _input, runOpts) => {
				opts.push(runOpts);
				return REPORT;
			},
		});

		await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: "plan_abc123",
			sessionRef: "sess_fresh",
			fresh: true,
		});

		await companyResearchOutcome(fake, COMPANY, {
			confirm: true,
			plan: "plan_abc123",
			sessionRef: "sess_background",
		});

		expect(opts[0]?.fresh).toBe(true);
		expect(opts[1]?.fresh).toBeUndefined();
	});
});

for(const priceTypicalMicro of [undefined,0,2100]) test(`confirmation carries typical ${priceTypicalMicro}`,async()=>{
 const fake=availableFake();fake.routeOutcomes({estimate:()=>({...ESTIMATE,priceTypicalMicro})});
 const attempt=await companyResearchOutcome(fake,COMPANY);expect(attempt.via).toBe('needs-confirmation');
 if(attempt.via!=='needs-confirmation')throw new Error('Missing review');
 expect(attempt.priceMaxMicro).toBe(4200);expect(attempt.priceTypicalMicro).toBe(priceTypicalMicro);
 if(priceTypicalMicro===undefined)expect(attempt.summary).toContain('for an estimated');else expect(attempt.summary).toContain(`usually about $${(priceTypicalMicro/1_000_000).toFixed(6)} (at most $0.004200)`);
 expect(fake.outcomeCalls.some(call=>call.verb==='run')).toBe(false);
});
