// The company research outcome: one platform run in place of the multi-step
// sequence the agent would otherwise drive tool call by tool call. The attempt is
// a function of the client so tests can pass any object with the same surface.
//
// Flow: check `available` on the description at run time (it changes), estimate,
// show that estimate to the person before a run that costs, then run — passing the
// estimate's plan hash when the outcome needs approval.
//
// Fallback contract: when the outcome is unavailable, refused, or the plan says it
// cannot run, the caller uses the capability path (web.extract) instead. A run that
// failed midway is reported, not retried here — its steps may already have acted.

import { createHash, randomUUID } from "node:crypto";
import { idempotencyKey, type Pramaan } from "@crm/pramaan";
import { z } from "zod";
import { currentFresh } from "./focus";

export type ResearchBrief = {
	readonly positioning: string | null;
	readonly pricingModel: string | null;
	readonly targetCustomer: string | null;
	readonly notableCustomers: ReadonlyArray<string>;
	readonly recentNews: ReadonlyArray<string>;
	readonly sections: ReadonlyArray<{ label: string; value: string }>;
};

export type CompanyResearchAttempt =
	| { readonly via: "unavailable"; readonly reason: string }
	| { readonly via: "failed"; readonly reason: string }
	| {
			readonly via: "result-unknown";
			readonly reason: "Result unknown — the run may have started; check before retrying";
	  }
	| {
			readonly via: "needs-confirmation";
			readonly plan: string;
			readonly priceMinMicro: number;
			readonly priceMaxMicro: number;
 readonly priceTypicalMicro?: number;
			readonly summary: string;
			readonly retryToken?: string;
	  }
	| {
			readonly via: "outcome";
			readonly brief: ResearchBrief;
			readonly meta: {
				readonly outcome: "company.research";
				readonly plan: string;
				readonly priceMinMicro: number;
				readonly priceMaxMicro: number;
 readonly priceTypicalMicro?: number;
				readonly chargedMicro: number;
				readonly completeness: string;
				readonly retryAvailable: boolean;
			};
	  };

const OUTCOME_ID = "company.research";

export type CompanyResearchOptions = {
	/** The person has seen the estimate and agreed to the run. */
	confirm?: boolean;
	/** Request a fresh estimate after the person explicitly asks to retry. Never runs. */
	retry?: boolean;
	/** Confirmation token returned with a manual retry estimate. */
	retryToken?: string;
	signal?: AbortSignal;
	sessionRef?: string;
	/** The plan hash from the first call's estimate. */
	plan?: string;
	/** The person asked for current data: bypass the platform's answer copy. */
	fresh?: boolean;
};

const stringOrNull = z.string().trim().min(1).nullable().catch(null);
const stringList = z
	.array(z.string().min(1).nullable().catch(null))
	.transform((items) => items.filter((item) => item !== null))
	.catch([]);

function asString(value: unknown): string | null {
	return stringOrNull.parse(value);
}

function asList(value: unknown): string[] {
	return stringList.parse(value);
}

function briefFromResult(
	run: Awaited<ReturnType<Pramaan["outcomes"]["run"]>>,
): ResearchBrief {
	const result = run.result;
	const raw = (result && typeof result === "object" ? result : {}) as Record<
		string,
		unknown
	>;
	const profile = (
		raw.profile && typeof raw.profile === "object" ? raw.profile : {}
	) as Record<string, unknown>;
	// The platform does not check that news is about the company, so keep only
	// items whose title or summary names it.
	// ponytail: plain name match; swap for the platform's relevance check when it lands.
	const companyName = (asString(raw.name) ?? asString(profile.name))?.toLowerCase();
	const aboutCompany = (items: unknown) =>
		Array.isArray(items) && companyName
			? items.filter((item) => {
					const text =
						typeof item === "string"
							? item
							: `${(item as { title?: unknown })?.title ?? ""} ${(item as { summary?: unknown })?.summary ?? ""}`;
					return text.toLowerCase().includes(companyName);
				})
			: items;
	const record: Record<string, unknown> = {
		...raw,
		news: aboutCompany(raw.news),
		recentNews: aboutCompany(raw.recentNews),
	};

	const field = (...names: string[]): string | null => {
		for (const name of names) {
			const found = asString(record[name]) ?? asString(profile[name]);
			if (found) return found;
		}
		return null;
	};

	const show = (value: unknown): string | null => {
		if (typeof value === "number") return String(value);
		if (value && typeof value === "object" && !Array.isArray(value))
			return JSON.stringify(value);
		if (Array.isArray(value) && value.length)
			return value
				.map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
				.join(", ");
		return asString(value);
	};
	const sections: { label: string; value: string }[] = [];
	const add = (
		label: string,
		fields: string[],
		source: string,
		dependency?: string,
	) => {
		const values = fields.flatMap((key) => {
			const value = show(record[key] ?? profile[key]);
			return value ? [`${fields.length > 1 ? `${key}: ` : ""}${value}`] : [];
		});
		const statuses = run.steps.filter(
			(step) => step.id === source || step.id === dependency,
		);
		const unavailable = statuses.some((step) => step.status === "failed");
		const skipped = statuses.some((step) => step.status === "skipped");
		const reason = unavailable
			? "Source unavailable in this run."
			: skipped
				? ["tech", "jobs", "similar"].includes(source)
					? "Not requested in this run."
					: "Source was skipped; not checked."
				: "Not reported by the source; absence is not confirmed.";
		sections.push({ label, value: values.length ? values.join("; ") : reason });
	};
	add("Name", ["name"], "profile");
	add("Industry", ["industry"], "profile");
	// Preserve both earlier count text and newer employee bands without guessing.
	add("Employees", ["employeeRange"], "profile");
	add("Founded", ["foundedYear"], "profile");
	add("Location", ["location"], "profile");
	add("Company profile", ["linkedinUrl"], "social");
	for (const [label, key] of [
		["Legal name", "legalName"],
		["Register number", "registryNumber"],
		["Register status", "status"],
		["Incorporated", "incorporatedOn"],
		["Registered address", "registeredAddress"],
	])
		add(label!, [key!], "registry", "registry-search");
	add("News", ["recentNews", "news"], "news");
	add("Website", ["site", "website"], "site", "site-map");
	add("Pricing", ["pricingModel", "pricing"], "site", "site-map");
	add(
		"Customers served",
		["targetCustomer", "target_market"],
		"site",
		"site-map",
	);
	add(
		"Notable customers",
		["notableCustomers", "customers"],
		"site",
		"site-map",
	);
	add("Technologies", ["technologies"], "tech");
	add("Open roles", ["openRoles"], "jobs");
	add("Similar companies", ["similar"], "similar");
	return {
		sections,
		positioning: field("summary", "positioning", "description"),
		pricingModel: field("pricingModel", "pricing"),
		targetCustomer: field("targetCustomer", "target_market"),
		notableCustomers: asList(record.notableCustomers ?? record.customers),
		recentNews: asList(record.recentNews ?? record.news),
	};
}

function microDollars(micro: number): string {
	return `$${(micro / 1_000_000).toFixed(6)}`;
}

/**
 * Try the `company.research` outcome for one company. Without `confirm`, the attempt
 * answers `needs-confirmation` carrying the estimate (steps, worst-case price, plan
 * hash) for the person to approve; a run that costs never starts unconfirmed.
 */
async function performCompanyResearch(
	api: Pramaan,
	company: {
		readonly name: string;
		readonly domain: string | null;
		readonly website: string | null;
	},
	options: CompanyResearchOptions = {},
): Promise<CompanyResearchAttempt> {
	const description = await api.outcomes.get(OUTCOME_ID).catch(() => null);
	if (!description || description.available !== true) {
		return {
			via: "unavailable",
			reason: "The research outcome is not available.",
		};
	}

	const input = company.domain
		? { domain: company.domain }
		: company.name
			? { name: company.name }
			: null;
	if (!input) {
		return {
			via: "unavailable",
			reason: "The company has no domain or name to research.",
		};
	}

	let estimate: Awaited<ReturnType<typeof api.outcomes.estimate>>;
	try {
		estimate = await api.outcomes.estimate(OUTCOME_ID, input);
	} catch (error) {
		return {
			via: "unavailable",
			reason: "The research estimate could not be prepared.",
		};
	}
	if (!estimate.canRun) {
		return {
			via: "unavailable",
			reason:
				estimate.reason ?? "The research outcome cannot run for this company.",
		};
	}

	const confirmed = options.confirm === true;
	if (!confirmed || (estimate.requiresApproval && options.plan === undefined)) {
		const steps = estimate.steps
			.map((step) => step.label)
			.slice(0, 6)
			.join(", ");
		return {
			via: "needs-confirmation",
			plan: estimate.plan,
			priceMinMicro: estimate.priceMinMicro,
			priceMaxMicro: estimate.priceMaxMicro,
 priceTypicalMicro: estimate.priceTypicalMicro,
			summary:
				`Platform research runs ${estimate.steps.length} step(s) — ${steps} — ` +
				(estimate.priceTypicalMicro !== undefined ? `usually about ${microDollars(estimate.priceTypicalMicro)} (at most ${microDollars(estimate.priceMaxMicro)}). ` : `for an estimated ${microDollars(estimate.priceMinMicro)}–${microDollars(estimate.priceMaxMicro)}. `) +
				`Call again with confirm: true and plan: "${estimate.plan}" once the person agrees.`,
		};
	}

	try {
		const run = await api.outcomes.run(OUTCOME_ID, input, {
			...(options.fresh || currentFresh() ? { fresh: true } : {}),
			...(estimate.requiresApproval && options.plan !== undefined
				? { plan: options.plan }
				: {}),
			idempotencyKey: options.sessionRef
				? createHash("sha256")
						.update(
							JSON.stringify([
								options.sessionRef,
								input,
								options.plan,
								options.retryToken,
							]),
						)
						.digest("hex")
				: idempotencyKey(),
			...(options.signal ? { signal: options.signal } : {}),
		});
		if (run.steps?.some((step) => step.effect === "unknown"))
			return {
				via: "failed",
				reason:
					"A research step may already have acted. Check before retrying; nothing was retried automatically.",
			};
		if (run.status !== "done") {
			return {
				via: "failed",
				reason:
					(run.error as { code?: string } | undefined)?.code ===
					"upstream_timeout"
						? "Research exceeded the platform time limit and ended failed. Check what completed before starting again."
						: run.status === "cancelled"
							? "Research was cancelled. Completed steps remain; check before starting again."
							: "Research ended without a completed brief. Check what completed before starting again.",
			};
		}
		return {
			via: "outcome",
			brief: briefFromResult(run),
			meta: {
				outcome: OUTCOME_ID,
				plan: run.plan,
				priceMinMicro: estimate.priceMinMicro,
				priceMaxMicro: estimate.priceMaxMicro,
 priceTypicalMicro: estimate.priceTypicalMicro,
				chargedMicro: run.cost.chargedMicro,
				completeness: run.completeness ?? "complete",
				retryAvailable: run.steps.some((step) => step.status === "failed"),
			},
		};
	} catch (error) {
		const pramaanError = error as {
			status?: number;
			code?: string;
			jobId?: string;
		};
		if (pramaanError.status === 429 && !pramaanError.jobId)
			return {
				via: "failed",
				reason: "Research is busy. Try later; this run did not start.",
			};
		if (
			(pramaanError.status === 502 &&
				pramaanError.code === "upstream_unavailable" &&
				!pramaanError.jobId) ||
			(!pramaanError.jobId &&
				(pramaanError.status === 403 || pramaanError.status === 409))
		) {
			return {
				via: "unavailable",
				reason: `The research outcome was refused (${pramaanError.status}).`,
			};
		}
		// A paid start that times out (a gateway 504, or the request never
		// getting a response) may still have started the job — the held
		// estimate is charged either way. That is never "failed" and never
		// retried automatically: a manual retry needs a new Idempotency-Key
		// and a fresh estimate.
		if (
			!pramaanError.jobId &&
			(pramaanError.code === "upstream_timeout" ||
				(pramaanError.code === "upstream_unavailable" &&
					pramaanError.status === undefined))
		) {
			return {
				via: "result-unknown",
				reason: "Result unknown — the run may have started; check before retrying",
			};
		}
		return {
			via: "failed",
			reason:
				"Research could not be confirmed. Check its status before retrying; nothing was retried automatically.",
		};
	}
}

const retryApprovals = new WeakMap<
	Pramaan,
	Map<string, { scope: string; plan: string }>
>();

const uncertainAttempts = new WeakMap<
	Pramaan,
	Map<string, CompanyResearchAttempt>
>();

export async function companyResearchOutcome(
	api: Pramaan,
	company: {
		readonly name: string;
		readonly domain: string | null;
		readonly website: string | null;
	},
	options: CompanyResearchOptions = {},
): Promise<CompanyResearchAttempt> {
	const key =
		options.sessionRef && options.confirm
			? JSON.stringify([
					options.sessionRef,
					company.name,
					company.domain,
					options.retryToken,
				])
			: null;
	const scope = JSON.stringify([
		options.sessionRef,
		company.name,
		company.domain,
	]);
	if (options.retry) {
		const attempt = await performCompanyResearch(api, company, {
			...options,
			confirm: false,
		});
		if (attempt.via !== "needs-confirmation") return attempt;
		const token = randomUUID();
		const entries =
			retryApprovals.get(api) ??
			new Map<string, { scope: string; plan: string }>();
		if (entries.size >= 500) entries.delete(entries.keys().next().value!);
		entries.set(token, { scope, plan: attempt.plan });
		retryApprovals.set(api, entries);
		return { ...attempt, retryToken: token };
	}
	const previous = key ? uncertainAttempts.get(api)?.get(key) : null;
	if (previous) return previous;
	if (options.retryToken && options.confirm) {
		const approval = retryApprovals.get(api)?.get(options.retryToken);
		if (!approval || approval.scope !== scope || approval.plan !== options.plan)
			return {
				via: "failed",
				reason:
					"Ask for a fresh retry estimate and approve it before retrying.",
			};
		retryApprovals.get(api)?.delete(options.retryToken);
	}
	const attempt = await performCompanyResearch(api, company, options);
	if (
		key &&
		(attempt.via === "failed" ||
			attempt.via === "result-unknown" ||
			(attempt.via === "outcome" && attempt.meta.retryAvailable))
	) {
		const entries =
			uncertainAttempts.get(api) ?? new Map<string, CompanyResearchAttempt>();
		if (entries.size >= 500) entries.delete(entries.keys().next().value!);
		entries.set(key, attempt);
		uncertainAttempts.set(api, entries);
	}
	return attempt;
}

/** The same text is saved to the timeline and returned to the person. */
export function formatOutcomeBrief(
	attempt: Extract<CompanyResearchAttempt, { via: "outcome" }>,
): string {
	return [
		`Research completeness: ${attempt.meta.completeness}`,
		...(attempt.brief.positioning ? [attempt.brief.positioning] : []),
		...attempt.brief.sections.map(
			(section) => `${section.label}: ${section.value}`,
		),
		`Actually charged: ${microDollars(attempt.meta.chargedMicro)}`,
		...(attempt.meta.retryAvailable
			? [
					"Some sources failed. You can ask to retry manually; a fresh estimate and approval are required before another run.",
				]
			: []),
	].join("\n\n");
}
