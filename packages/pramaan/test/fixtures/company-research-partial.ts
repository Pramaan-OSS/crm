// Shape recorded from the owner's first default-options run. Plan/job identifiers
// are fixture values; filled profile text not supplied in the review is illustrative.
const step = (
	id: string,
	capability: string,
	status: string,
	code?: string,
) => ({
	id,
	label: id,
	capability,
	status,
	effectClass: "read_only",
	effect: "none",
	calls: status === "skipped" ? 0 : 1,
	...(code ? { errors: [{ code }] } : {}),
});
export const companyResearchPartialReport = {
	outcome: "company.research",
	version: 1,
	plan: "fixture_plan",
	status: "done",
	completeness: "partial",
	usage: { calls: 6 },
	result: {
		name: "Stripe",
		industry: "Financial services",
		employeeRange: "8000",
		foundedYear: 2010,
		location: { country: "San Francisco United States" },
		linkedinUrl: "https://www.linkedin.com/company/stripe",
		summary: "Payments infrastructure.",
		legalName: null,
		registryNumber: null,
		status: null,
		incorporatedOn: null,
		registeredAddress: null,
		news: [],
		technologies: [],
		openRoles: [],
		similar: [],
	},
	evidence: {},
	missing: [
		"legalName",
		"registryNumber",
		"status",
		"incorporatedOn",
		"registeredAddress",
	].map((field) => ({
		field,
		reason: "step_skipped",
		detail: "No register entry matched the company name with confidence",
	})),
	// Optional skipped-step capability ids were not supplied in the review.
	steps: [
		step("profile", "companies.enrich", "ok"),
		step(
			"registry-search",
			"companies.registry.search",
			"failed",
			"upstream_unavailable",
		),
		step("registry", "companies.registry.get", "skipped"),
		step("news", "companies.news", "failed", "upstream_unavailable"),
		step("site-map", "web.map", "failed", "invalid_request"),
		step("site", "web.read", "skipped"),
		step("social", "linkedin.company.profile", "ok"),
		step("tech", "fixture.tech", "skipped"),
		step("jobs", "fixture.jobs", "skipped"),
		step("similar", "fixture.similar", "skipped"),
		step("summary", "llm.complete", "ok"),
	],
	cost: { holdMicro: 597220, chargedMicro: 15300, capabilities: [] },
};
export const companyResearchDefaultEstimate = {
	outcome: "company.research",
	version: 1,
	plan: "fixture_plan",
	ready: true,
	canRun: true,
	priceMinMicro: 260000,
	priceMaxMicro: 597220,
	balanceMicro: 5000000,
	// Optional skipped-step capability ids were not supplied in the review.
	steps: [],
};

// Proposed next-deploy shapes, not another live report. Place fields are illustrative.
export const companyResearchBandReport = {
	...companyResearchPartialReport,
	result: {
		...companyResearchPartialReport.result,
		employeeRange: "5001+",
		location: { city: "Example City", country: "Example Country" },
	},
	missing: companyResearchPartialReport.missing.map((item) => ({
		...item,
		detail: "unavailable, could not be checked",
	})),
};
