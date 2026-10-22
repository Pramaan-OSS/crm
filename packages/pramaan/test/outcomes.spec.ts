// Outcome client semantics against a scripted fetch — no network. Covers the run
// report shape, the 202 job path, the approval-plan errors, and the availability
// flag the run-time checks depend on.

import { describe, expect, test } from "bun:test";
import { PramaanClient } from "../src/sdk/client.ts";
import { PramaanError } from "../src/sdk/errors.ts";

import { companyResearchPartialReport } from "./fixtures/company-research-partial";

const BASE = "https://pramaan.test";

type Scripted = {
	url: string;
	method: string;
	body?: unknown;
	headers: Headers;
};

function scriptedClient(
	handler: (call: Scripted, index: number) => Response,
	sleep: () => Promise<void> = async () => {},
) {
	const calls: Scripted[] = [];
	let index = 0;
	const client = new PramaanClient({
		apiKey: "sk_live_test",
		baseUrl: BASE,
		sleep,
		fetch: async (url, init) => {
			const call: Scripted = {
				url,
				method: init.method ?? "GET",
				body: init.body ? JSON.parse(String(init.body)) : undefined,
				headers: new Headers(init.headers),
			};
			calls.push(call);
			return handler(call, index++);
		},
	});
	return { client, calls };
}

const ESTIMATE = {
	outcome: "company.research",
	version: 3,
	plan: "plan_abc123",
	ready: true,
	can_run: true,
	price_min_micro: 900,
	price_max_micro: 4200,
	balance_micro: 5_000_000,
	steps: [
		{
			id: "enrich",
			label: "Company profile",
			capability: "companies.enrich",
			effect_class: "read_only",
			required: true,
			max_calls: 1,
			requires_approval: false,
			price_max_micro: 800,
		},
	],
};

const REPORT = {
	outcome: "company.research",
	version: 3,
	plan: "plan_abc123",
	status: "done",
	completeness: "complete",
	result: { profile: { name: "Example Co" }, summary: "A company." },
	evidence: { "profile.name": [{ step: "enrich", confidence: "high" }] },
	missing: [{ field: "news", reason: "no news source answered" }],
	steps: [
		{
			id: "enrich",
			label: "Company profile",
			capability: "companies.enrich",
			effect_class: "read_only",
			status: "done",
			calls: 1,
			effect: "none",
		},
	],
	error: null,
	cost: {
		hold_micro: 4200,
		charged_micro: 800,
		capabilities: [{ id: "companies.enrich", calls: 1, charged_micro: 800 }],
	},
};

describe("outcomes.estimate", () => {
	test("posts the input and maps the plan, price and steps", async () => {
		const { client, calls } = scriptedClient(
			() => new Response(JSON.stringify(ESTIMATE), { status: 200 }),
		);
		const estimate = await client.outcomes.estimate("company.research", {
			domain: "example.com",
		});

		const call = calls[0]!;
		expect(call.url).toBe(`${BASE}/v1/outcomes/company.research/estimate`);
		expect(call.body).toEqual({ input: { domain: "example.com" } });
		expect(estimate.plan).toBe("plan_abc123");
		expect(estimate.canRun).toBe(true);
		expect(estimate.priceMaxMicro).toBe(4200);
		expect(estimate.steps[0]?.capability).toBe("companies.enrich");
	});
});

describe("outcomes.run", () => {
	test("a sync run returns the mapped report with steps and cost", async () => {
		const { client, calls } = scriptedClient(
			() => new Response(JSON.stringify(REPORT), { status: 200 }),
		);
		const run = await client.outcomes.run("company.research", {
			domain: "example.com",
		});

		expect(calls[0]?.url).toBe(`${BASE}/v1/outcomes/company.research`);
		expect(run.status).toBe("done");
		expect(run.completeness).toBe("complete");
		expect((run.result as { summary: string }).summary).toBe("A company.");
		expect(run.steps[0]?.effect).toBe("none");
		expect(run.cost.chargedMicro).toBe(800);
	});

	test("a long run answers 202 and the report arrives through the job", async () => {
		const { client, calls } = scriptedClient((call) => {
			if (call.url.endsWith("/v1/outcomes/company.research")) {
				return new Response(
					JSON.stringify({ job_id: "job_out_1", status: "running" }),
					{ status: 202 },
				);
			}
			if (call.url.endsWith("/v1/jobs/job_out_1")) {
				return new Response(
					JSON.stringify({
						job_id: "job_out_1",
						status: "done",
						result: REPORT,
					}),
					{ status: 200 },
				);
			}
			return new Response("{}", { status: 404 });
		});
		const run = await client.outcomes.run("company.research", {
			domain: "example.com",
		});

		expect(calls.some((call) => call.url.endsWith("/v1/jobs/job_out_1"))).toBe(
			true,
		);
		expect(run.status).toBe("done");
		expect(run.cost.holdMicro).toBe(4200);
	});

	test("a failed long run surfaces the job error", async () => {
		const { client } = scriptedClient((call) => {
			if (call.url.endsWith("/v1/outcomes/company.research")) {
				return new Response(
					JSON.stringify({ job_id: "job_out_2", status: "running" }),
					{ status: 202 },
				);
			}
			return new Response(
				JSON.stringify({
					job_id: "job_out_2",
					status: "failed",
					error: {
						code: "upstream_failed",
						message: "A required step failed.",
					},
				}),
				{ status: 200 },
			);
		});
		try {
			await client.outcomes.run("company.research", { domain: "example.com" });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(PramaanError);
			expect((error as PramaanError).code).toBe("upstream_failed");
		}
	});

	test("a run that needs an approved plan is refused 403 without the header", async () => {
		const { client, calls } = scriptedClient(
			() =>
				new Response(
					JSON.stringify({
						error: {
							code: "approval_required",
							message: "Approval is required.",
						},
					}),
					{ status: 403 },
				),
		);
		try {
			await client.outcomes.run("deal.brief", { deal_id: "d1" });
			expect.unreachable();
		} catch (error) {
			expect((error as PramaanError).status).toBe(403);
			expect((error as PramaanError).code).toBe("unauthorized");
			expect((error as PramaanError).message).toBe("Approval is required.");
		}
		expect(calls[0]?.headers.get("Pramaan-Plan")).toBeNull();
	});

	test("the estimate's plan rides to the run as the Pramaan-Plan header", async () => {
		const { client, calls } = scriptedClient(
			() => new Response(JSON.stringify(REPORT), { status: 200 }),
		);
		await client.outcomes.run(
			"deal.brief",
			{ deal_id: "d1" },
			{ plan: "plan_abc123", idempotencyKey: "idem-1" },
		);
		expect(calls[0]?.headers.get("Pramaan-Plan")).toBe("plan_abc123");
		expect(calls[0]?.headers.get("Idempotency-Key")).toBe("idem-1");
	});

	test("a changed input after the estimate is refused 409", async () => {
		const { client } = scriptedClient(
			() =>
				new Response(
					JSON.stringify({
						error: {
							code: "conflict",
							message: "The plan no longer matches this input.",
						},
					}),
					{ status: 409 },
				),
		);
		try {
			await client.outcomes.run(
				"company.research",
				{ domain: "other.example" },
				{ plan: "plan_abc123" },
			);
			expect.unreachable();
		} catch (error) {
			expect((error as PramaanError).status).toBe(409);
		}
	});

	test("a run of an unavailable outcome surfaces 502 upstream_unavailable for the fallback", async () => {
		const { client } = scriptedClient(
			() =>
				new Response(
					JSON.stringify({
						error: {
							code: "upstream_unavailable",
							message: "This outcome cannot run yet.",
						},
					}),
					{ status: 502 },
				),
		);
		try {
			await client.outcomes.run("crm.record.enrich", { record_id: "r1" });
			expect.unreachable();
		} catch (error) {
			const pramaanError = error as PramaanError;
			expect(pramaanError.status).toBe(502);
			expect(pramaanError.code).toBe("upstream_unavailable");
		}
	});
});

describe("outcomes.list and outcomes.get", () => {
	test("the list maps the availability flag the run-time checks rely on", async () => {
		const { client } = scriptedClient(
			() =>
				new Response(
					JSON.stringify({
						results: [
							{ id: "company.research", description: "d", available: true },
							{ id: "crm.dedupe", description: "d", available: false },
						],
					}),
					{ status: 200 },
				),
		);
		const rows = await client.outcomes.list();
		expect(rows.find((row) => row.id === "company.research")?.available).toBe(
			true,
		);
		expect(rows.find((row) => row.id === "crm.dedupe")?.available).toBe(false);
	});

	test("the description carries the schemas and steps", async () => {
		const { client } = scriptedClient(
			() =>
				new Response(
					JSON.stringify({
						id: "company.research",
						description: "d",
						available: true,
						input_schema: { type: "object" },
						options_schema: { type: "object" },
						result_schema: { type: "object" },
						steps: [
							{
								id: "enrich",
								label: "Company profile",
								capability: "companies.enrich",
								effect_class: "read_only",
								required: true,
								max_calls: 1,
								requires_approval: false,
								price_max_micro: 800,
							},
						],
					}),
					{ status: 200 },
				),
		);
		const description = await client.outcomes.get("company.research");
		expect(description.available).toBe(true);
		expect(description.steps[0]?.capability).toBe("companies.enrich");
		expect(description.inputSchema).toEqual({ type: "object" });
	});
});

describe("long outcome reports", () => {
	test("start 429 is never retried even when requested", async () => {
		const { client, calls } = scriptedClient(
			() =>
				new Response(JSON.stringify({ error: { code: "rate_limited" } }), {
					status: 429,
				}),
		);
		await expect(
			client.outcomes.run("company.research", {}, { retry: true }),
		).rejects.toMatchObject({ status: 429 });
		expect(calls).toHaveLength(1);
	});
	test("the stop signal cancels the accepted job once and preserves its report", async () => {
		const controller = new AbortController();
		const report = {
			...REPORT,
			status: "cancelled",
			steps: [{ id: "read", label: "Read", effect: "done", calls: 1 }],
		};
		const { client, calls } = scriptedClient((call) => {
			if (call.url.endsWith("/v1/outcomes/company.research")) {
				controller.abort();
				return new Response(
					JSON.stringify({ job_id: "job-one", status: "running" }),
					{ status: 202 },
				);
			}
			expect(call.url).toBe(`${BASE}/v1/jobs/job-one/cancel`);
			expect(call.method).toBe("POST");
			return new Response(
				JSON.stringify({
					job_id: "job-one",
					status: "cancelled",
					result: report,
				}),
			);
		});
		const result = await client.outcomes.run(
			"company.research",
			{},
			{ signal: controller.signal },
		);
		expect(result.status).toBe("cancelled");
		expect(result.steps[0]?.effect).toBe("done");
		expect(calls).toHaveLength(2);
	});
	test("failed job retains timeout and unknown effects after 35 minutes", async () => {
		const original = Date.now;
		let now = 0;
		Date.now = () => now;
		try {
			const report = {
				...REPORT,
				status: "failed",
				error: { code: "upstream_timeout" },
				steps: [{ id: "read", effect: "unknown", calls: 1 }],
			};
			const { client, calls } = scriptedClient(
				(call, index) =>
					index === 0
						? new Response(
								JSON.stringify({ job_id: "long-job", status: "running" }),
								{ status: 202 },
							)
						: new Response(
								JSON.stringify({
									job_id: "long-job",
									status: now > 35 * 60_000 ? "failed" : "running",
									...(now > 35 * 60_000
										? { result: report, error: { code: "upstream_timeout" } }
										: {}),
								}),
							),
				async () => {
					now += 60_000;
				},
			);
			const result = await client.outcomes.run("company.research", {});
			expect(result.status).toBe("failed");
			expect(result.error).toEqual({ code: "upstream_timeout" });
			expect(result.steps[0]?.effect).toBe("unknown");
			expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
		} finally {
			Date.now = original;
		}
	});
	test("polling failures keep the accepted job reference", async () => {
		const { client } = scriptedClient((_call, index) =>
			index === 0
				? new Response(
						JSON.stringify({ job_id: "accepted", status: "running" }),
						{ status: 202 },
					)
				: new Response(
						JSON.stringify({ error: { code: "upstream_unavailable" } }),
						{ status: 502 },
					),
		);
		await expect(
			client.outcomes.run("company.research", {}),
		).rejects.toMatchObject({ jobId: "accepted", retryable: false });
	});
});

test("owner report shape survives an accepted job and running poll", async () => {
	const report = companyResearchPartialReport;
	const wire = {
		...report,
		steps: report.steps.map((step) => ({
			...step,
			effect_class: step.effectClass,
		})),
		cost: {
			hold_micro: report.cost.holdMicro,
			charged_micro: report.cost.chargedMicro,
			capabilities: [],
		},
	};
	const { client, calls } = scriptedClient((_call, index) =>
		Response.json(
			index === 0
				? { job_id: "fixture_job", status: "running" }
				: index === 1
					? { job_id: "fixture_job", status: "running" }
					: { job_id: "fixture_job", status: "done", result: wire },
			{ status: index === 0 ? 202 : 200 },
		),
	);
	const result = await client.outcomes.run("company.research", {
		domain: "stripe.com",
	});
	expect(result.status).toBe("done");
	expect(result.completeness).toBe("partial");
	expect(result.result).toEqual(report.result);
	expect(result.missing).toEqual(report.missing);
	expect(
		result.steps.find((step) => step.id === "registry-search")?.status,
	).toBe("failed");
	expect(result.steps.find((step) => step.id === "registry")?.status).toBe(
		"skipped",
	);
	expect(result.cost).toEqual(report.cost);
	expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
});
for (const typical of [undefined, 0, 2100])
	test(`optional typical estimate ${typical}`, async () => {
		const client = new PramaanClient({
			apiKey: "fake",
			fetch: async () =>
				Response.json({
					price_max_micro: 4200,
					...(typical === undefined ? {} : { price_typical_micro: typical }),
					ready: true,
					can_run: true,
					steps: [],
				}),
		});
		for (const estimate of [
			await client.capabilities.estimate("companies.search", {}),
			await client.outcomes.estimate("company.research", {}),
		]) {
			expect(estimate.priceMaxMicro).toBe(4200);
			expect(estimate.priceTypicalMicro).toBe(typical);
			if (typical === undefined)
				expect(estimate).not.toHaveProperty("priceTypicalMicro");
		}
	});
