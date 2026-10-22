import { ActivityType, db, type Prisma } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import {
	type CompanyResearchOptions,
	companyResearchOutcome,
	formatOutcomeBrief,
} from "../lib/company-research";
import { extract, type JsonSchema } from "../lib/context";
import { spend } from "../lib/focus";
import { pramaan } from "../lib/pramaan";

const RESEARCH_SCHEMA: JsonSchema = {
	type: "object",
	properties: {
		positioning: {
			type: "string",
			description: "One paragraph: what they sell and who to.",
		},
		pricingModel: {
			type: "string",
			description: "How they charge — per seat, usage, flat, enterprise-only.",
		},
		targetCustomer: {
			type: "string",
			description: "The customer they describe themselves as serving.",
		},
		notableCustomers: {
			type: "array",
			items: { type: "string" },
			description: "Named customers or logos on the site.",
		},
		recentNews: {
			type: "array",
			items: { type: "string" },
			description: "Recent announcements, funding, or launches.",
		},
	},
	required: ["positioning"],
};

const RESEARCH_INSTRUCTIONS =
	"Read this company's marketing site and answer as a salesperson preparing " +
	"for a first call. Be specific and factual; leave a field empty rather than " +
	"guessing.";

const briefText = z.string().trim().min(1).nullable().catch(null);

const briefList = z
	.array(z.string().nullable().catch(null))
	.transform((items) => items.filter((item) => item !== null))
	.catch([]);

const briefScalar = z
	.union([z.string(), z.number(), z.boolean()])
	.nullable()
	.catch(null);

const researchBrief = z
	.object({
		positioning: briefText,
		pricingModel: briefText,
		targetCustomer: briefText,
		notableCustomers: briefList,
		recentNews: briefList,
	})
	.catch({
		positioning: null,
		pricingModel: null,
		targetCustomer: null,
		notableCustomers: [],
		recentNews: [],
	});

type ResearchBrief = z.infer<typeof researchBrief>;

export default defineTool({
	description:
		"Write a sourced company timeline brief. Estimate before approval. Manual retry requires a fresh estimate and token; check uncertain results first. Preserve partial source-failure reasons. Site fallback only when the outcome is unavailable.",
	inputSchema: z.object({
		companyId: z.string(),
		confirm: z
			.boolean()
			.default(false)
			.describe(
				"Set after the person agreed to the platform research run and its worst-case price. The first call returns the estimate instead of running.",
			),
		retry: z
			.boolean()
			.default(false)
			.describe(
				"Only after the person asks to retry: request a fresh estimate, never start a run.",
			),
		retryToken: z
			.string()
			.optional()
			.describe(
				"Token from the fresh retry estimate; return with its plan and confirmation.",
			),
		plan: z
			.string()
			.optional()
			.describe(
				"The plan hash from the first call's estimate. Pass it back with confirm.",
			),
	}),
	async execute({ companyId, confirm, plan, retry, retryToken }, ctx) {
		const company = await db.company.findUnique({
			where: { id: companyId },
			select: {
				id: true,
				name: true,
				domain: true,
				website: true,
				ownerId: true,
			},
		});

		if (!company)
			return { written: false as const, reason: "No such company." };

		// The research budget is charged once, whichever path runs.
		let charged = false;
		const chargeBudget = () => {
			if (charged) return { ok: true as const };
			const outcome = spend(2);
			if (outcome.ok) charged = true;
			return outcome;
		};

		// One platform run covers the whole research sequence when it is available;
		// the single web.read below stays as the capability fallback. The estimate is
		// shown first: without `confirm` nothing runs and the estimate comes back for
		// the person to agree to.
		const api = pramaan();
		if (api) {
			if (confirm && !retry) {
				const charge = chargeBudget();
				if (!charge.ok)
					return { written: false as const, reason: charge.reason };
			}

			const attemptOptions: CompanyResearchOptions = {
				confirm,
				retry,
				...(retryToken ? { retryToken } : {}),
				signal: ctx.abortSignal,
				sessionRef: ctx.session.id,
			};
			if (plan !== undefined) attemptOptions.plan = plan;
			const attempt = await companyResearchOutcome(
				api,
				company,
				attemptOptions,
			);

			if (attempt.via === "needs-confirmation") {
				return {
					needsConfirmation: true as const,
					plan: attempt.plan,
					summary: attempt.summary,
					priceMinMicro: attempt.priceMinMicro,
					priceMaxMicro: attempt.priceMaxMicro,
 priceTypicalMicro: attempt.priceTypicalMicro,
					...(attempt.retryToken ? { retryToken: attempt.retryToken } : {}),
				};
			}
			if (attempt.via === "outcome") {
				const written = await writeResearchActivity(
					company,
					formatOutcomeBrief(attempt),
					{
						source: "company-research",
						outcome: attempt.meta.outcome,
						priceMinMicro: attempt.meta.priceMinMicro,
						priceMaxMicro: attempt.meta.priceMaxMicro,
						chargedMicro: attempt.meta.chargedMicro,
						completeness: attempt.meta.completeness,
						agent: "people-research",
					},
				);
				if (!written)
					return {
						written: false as const,
						reason: "No user to attribute to.",
					};
				await db.company.update({
					where: { id: companyId },
					data: { lastActivityAt: new Date() },
				});
				return {
					written: true as const,
					activityId: written.id,
					brief: formatOutcomeBrief(attempt),
					chargedMicro: attempt.meta.chargedMicro,
					retryAvailable: attempt.meta.retryAvailable,
				};
			}
			if (attempt.via === "result-unknown") {
				// Never retried automatically and never falling back to the
				// capability path: the held estimate may already be spent.
				return {
					written: false as const,
					reason: attempt.reason,
					retryAvailable: false,
				};
			}
			if (attempt.via === "failed") {
				return {
					written: false as const,
					reason: attempt.reason,
					retryAvailable: true,
					retryInstruction:
						"Check what completed first. Ask to retry manually for a fresh estimate and approval.",
				};
			}
			if (retry) return { written: false as const, reason: attempt.reason };
			// via "unavailable": the flag flipped or the run was refused — fall back.
		}

		const url =
			company.website ?? (company.domain ? `https://${company.domain}` : null);

		if (!url) {
			return {
				written: false as const,
				reason: "No website URL is stored for this company.",
			};
		}

		const charge = chargeBudget();
		if (!charge.ok) return { written: false as const, reason: charge.reason };

		const result = await extract(url, RESEARCH_SCHEMA, RESEARCH_INSTRUCTIONS);

		if (result.outcome === "failed") {
			return { written: false as const, reason: result.reason };
		}

		const scalar = briefScalar.parse(result.data);
		const written = await writeResearchActivity(
			company,
			scalar === null
				? String(result.data)
				: formatBrief(researchBrief.parse(scalar as unknown)),
			{
				source: "company-enrichment",
				capability: "web.extract",
				agent: "people-research",
			},
		);
		if (!written)
			return { written: false as const, reason: "No user to attribute to." };

		await db.company.update({
			where: { id: companyId },
			data: { lastActivityAt: new Date() },
		});

		return { written: true as const, activityId: written.id };
	},
});

function formatBrief(brief: {
	positioning: string | null;
	pricingModel: string | null;
	targetCustomer: string | null;
	notableCustomers: ReadonlyArray<string>;
	recentNews: ReadonlyArray<string>;
}): string {
	const lines: string[] = [];

	if (brief.positioning) lines.push(brief.positioning);
	if (brief.pricingModel) lines.push(`Pricing: ${brief.pricingModel}`);
	if (brief.targetCustomer) lines.push(`Sells to: ${brief.targetCustomer}`);

	if (brief.notableCustomers.length > 0) {
		lines.push(`Customers: ${brief.notableCustomers.join(", ")}`);
	}

	if (brief.recentNews.length > 0) {
		lines.push(
			`Recently:\n${brief.recentNews.map((item) => `• ${item}`).join("\n")}`,
		);
	}

	return lines.join("\n\n");
}

/** The timeline entry both research paths write, attributed to the company's owner. */
async function writeResearchActivity(
	company: {
		readonly id: string;
		readonly name: string;
		readonly ownerId: string | null;
	},
	body: string,
	meta: Prisma.InputJsonValue,
): Promise<{ readonly id: string } | null> {
	const author =
		company.ownerId ??
		(await db.user.findFirst({ select: { id: true } }))?.id ??
		null;
	if (!author) return null;

	const activity = await db.activity.create({
		data: {
			type: ActivityType.ENRICHMENT,
			subject: `Research brief — ${company.name}`,
			body,
			occurredAt: new Date(),
			companyId: company.id,
			createdById: author,
			meta,
		},
		select: { id: true },
	});
	return { id: activity.id };
}
