import type { Prisma } from "@crm/db";
import type { Brand } from "./context";

export type BrandUpdate = Prisma.CompanyUpdateInput;

export type CompanySnapshot = {
	name: string;
	nameIsPlaceholder: boolean;
	description: string | null;
	logoUrl: string | null;
	logoDarkUrl: string | null;
	iconUrl: string | null;
	iconDarkUrl: string | null;
	iconTone: string | null;
	brandColor: string | null;
	industry: string | null;
	subIndustry: string | null;
	city: string | null;
	stateCode: string | null;
	country: string | null;
	countryCode: string | null;
	phone: string | null;
	email: string | null;
	linkedinUrl: string | null;
	twitterUrl: string | null;
	githubUrl: string | null;
	pricingUrl: string | null;
	careersUrl: string | null;
};

function clean(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function fillable(key: string, current: CompanySnapshot): boolean {
	if (key === "iconUrl") return true;
	if (key === "name") return current.nameIsPlaceholder;
	return current[key as keyof CompanySnapshot] === null;
}

export function brandToUpdate(
	brand: Brand,
	current: CompanySnapshot,
): BrandUpdate {
	const update: BrandUpdate = {};

	const fill = <K extends keyof CompanySnapshot & keyof BrandUpdate>(
		key: K,
		value: string | null,
	) => {
		if (value && fillable(key, current)) {
			update[key] = value;
		}
	};

	fill("name", clean(brand.title));

	fill("description", clean(brand.description));

	// One logo comes back, where there used to be a set. It stands in for every slot.
	const logo = clean(brand.logoUrl);
	fill("logoUrl", logo);
	fill("iconUrl", logo);

	fill("industry", clean(brand.industry));

	fill("city", clean(brand.city));
	fill("country", clean(brand.country));

	fill("linkedinUrl", clean(brand.linkedinUrl));

	return update;
}

export function stillFillable(
	update: BrandUpdate,
	current: CompanySnapshot,
): BrandUpdate {
	return Object.fromEntries(
		Object.entries(update).filter(([key]) => fillable(key, current)),
	);
}

export function filledFields(update: BrandUpdate): string[] {
	return Object.keys(update);
}
