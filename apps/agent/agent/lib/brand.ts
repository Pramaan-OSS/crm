import { db, EnrichmentStatus } from "@crm/db";
import { copyCompanyLogo, isLegacyLogo } from "@crm/db/company-logo";
import type { OutcomeApproval, OutcomeAttempt, Pramaan } from "@crm/pramaan";
import { brandToUpdate, filledFields, stillFillable } from "./brand-mapping";
import { brandLogo } from "./brand-outcome";
import { brandByDomain, contextEnabled } from "./context";
import { UNLESS_COMPLETE } from "./enrichment";
import { pramaan } from "./pramaan";
import { failedCompanyResearchReason } from "./research-task-failure";

export type BrandResult = {
	enriched: boolean;
	attempt?: OutcomeAttempt;
	filled?: string[];
	mirrored?: string[];
	reason?: string;
	retryable?: boolean;
};

export type Spend = (units?: number) => { ok: boolean; reason?: string };

export const FREE: Spend = () => ({ ok: true });

const COMPANY_FIELDS = {
	id: true,
	name: true,
	domain: true,
	description: true,
	logoUrl: true,
	logoDarkUrl: true,
	iconUrl: true,
	iconDarkUrl: true,
	iconTone: true,
	brandColor: true,
	industry: true,
	subIndustry: true,
	city: true,
	stateCode: true,
	country: true,
	countryCode: true,
	phone: true,
	email: true,
	linkedinUrl: true,
	twitterUrl: true,
	githubUrl: true,
	pricingUrl: true,
	careersUrl: true,
} as const;

export async function runBrand({
	companyId,
	fresh = false,
	spend = FREE,
	client,
	approval = {},
}: {
	companyId: string;
	fresh?: boolean;
	spend?: Spend;
	client?: Pramaan;
	approval?: OutcomeApproval;
}): Promise<BrandResult> {
	const company = await db.company.findUnique({
		where: { id: companyId },
		select: COMPANY_FIELDS,
	});

	if (!company) return { enriched: false, reason: "No such company." };

	if (!client && !(await contextEnabled())) {
		const reason = "Pramaan is not configured, so there is nowhere to look.";
		await settle(companyId, EnrichmentStatus.SKIPPED, reason);
		return { enriched: false, reason };
	}

	if (!company.domain) {
		await settle(
			companyId,
			EnrichmentStatus.SKIPPED,
			"No domain to look up.",
			UNLESS_COMPLETE,
		);
		return { enriched: false, reason: "No domain on this company." };
	}

	const api = client ?? pramaan();
	if (!api) return { enriched: false, reason: "Pramaan is not configured." };
	const charge = spend(2);
	if (!charge.ok) return { enriched: false, reason: charge.reason };

	const attempt = await brandLogo(api, company.domain, approval);
	if (attempt.state !== "done")
		return {
			enriched: false,
			attempt,
			reason: attempt.state === "estimate" ? attempt.summary : attempt.reason,
		};
	const logoResult = attempt.report.result as
		| { logoFile?: unknown }
		| undefined;
	const logo = await copyCompanyLogo(api, companyId, logoResult?.logoFile);

	await db.company.updateMany({
		where: { id: companyId, ...UNLESS_COMPLETE },
		data: {
			enrichmentStatus: EnrichmentStatus.RUNNING,
			enrichmentError: null,
		},
	});

	const result = await brandByDomain(
		company.domain,
		fresh ? 0 : undefined,
		client,
	);

	if (result.outcome === "skipped") {
		await settle(companyId, EnrichmentStatus.SKIPPED, result.reason);
		return { enriched: false, reason: result.reason };
	}

	if (result.outcome === "failed") {
		await settle(companyId, EnrichmentStatus.FAILED, result.reason);
		return {
			enriched: false,
			reason: result.reason,
			retryable: result.retryable,
		};
	}

	const update = brandToUpdate(
		{ ...result.brand, logoUrl: logo },
		snapshot(company),
	);

	for (const key of ["logoUrl", "iconUrl"] as const) {
		if (isLegacyLogo(company[key]) && !logo) update[key] = null;
	}

	const mirrored = logo
		? ["logoUrl", "iconUrl"].filter((key) => key in update)
		: [];

	const filled = await db.$transaction(async (tx) => {
		const current = await tx.company.findUnique({
			where: { id: companyId },
			select: COMPANY_FIELDS,
		});

		if (!current) return null;

		const data = stillFillable(update, snapshot(current));
		const researchFailure = await failedCompanyResearchReason(companyId, tx);

		await tx.company.update({
			where: { id: companyId },
			data: {
				...data,
				enrichmentStatus: researchFailure
					? EnrichmentStatus.FAILED
					: EnrichmentStatus.COMPLETE,
				enrichedAt: researchFailure ? null : new Date(),
				enrichmentError: researchFailure,
			},
		});

		await tx.companyEnrichment.upsert({
			where: { companyId },
			create: {
				companyId,
				raw: { profile: result.raw, logo: attempt.report } as object,
			},
			update: {
				raw: { profile: result.raw, logo: attempt.report } as object,
				fetchedAt: new Date(),
			},
		});

		return filledFields(data);
	});

	if (!filled) return { enriched: false, reason: "No such company." };

	return {
		enriched: true,
		attempt,
		filled,
		mirrored: mirrored.filter((slot) => filled.includes(slot)),
	};
}

function snapshot<T extends { name: string; domain: string | null }>(
	company: T,
) {
	return { ...company, nameIsPlaceholder: company.name === company.domain };
}

export function brandOutcome(result: BrandResult): string {
	if (!result.enriched) return result.reason ?? "Nothing to fill.";

	const filled = result.filled ?? [];
	const mirrored = result.mirrored ?? [];

	if (filled.length === 0) {
		return "Everything company enrichment returned was already on the record.";
	}

	return `Filled ${filled.join(", ")}.${mirrored.length > 0 ? ` Copied ${mirrored.length} image(s) in-house.` : ""}`;
}

type SettleGuard =
	| typeof UNLESS_COMPLETE
	| { enrichmentStatus: EnrichmentStatus };

async function settle(
	companyId: string,
	status: EnrichmentStatus,
	error: string,
	guard: SettleGuard = { enrichmentStatus: EnrichmentStatus.RUNNING },
): Promise<void> {
	await db.company.updateMany({
		where: { id: companyId, ...guard },
		data: { enrichmentStatus: status, enrichmentError: error },
	});
}
