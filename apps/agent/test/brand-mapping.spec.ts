import { describe, expect, it } from "bun:test";
import {
	brandToUpdate,
	type CompanySnapshot,
	stillFillable,
} from "../agent/lib/brand-mapping";
import type { Brand } from "../agent/lib/context";

function emptyCompany(
	overrides: Partial<CompanySnapshot> = {},
): CompanySnapshot {
	return {
		name: "Stripe",
		nameIsPlaceholder: false,
		description: null,
		logoUrl: null,
		logoDarkUrl: null,
		iconUrl: null,
		iconDarkUrl: null,
		iconTone: null,
		brandColor: null,
		industry: null,
		subIndustry: null,
		city: null,
		stateCode: null,
		country: null,
		countryCode: null,
		phone: null,
		email: null,
		linkedinUrl: null,
		twitterUrl: null,
		githubUrl: null,
		pricingUrl: null,
		careersUrl: null,
		...overrides,
	};
}

describe("brandToUpdate", () => {
	const brand: Brand = {
		title: "Stripe",
		description: "Payments infrastructure for the internet.",
		logoUrl: "https://cdn/logo.svg",
		industry: "Finance",
		city: "South San Francisco",
		region: "California",
		country: "United States",
		linkedinUrl: "https://linkedin.com/company/stripe",
		websiteUrl: "https://stripe.com",
		employeeCount: 9000,
		foundedYear: 2010,
	};

	it("takes the one logo for every logo slot", () => {
		const update = brandToUpdate(brand, emptyCompany());

		expect(update.logoUrl).toBe("https://cdn/logo.svg");
		expect(update.iconUrl).toBe("https://cdn/logo.svg");
	});

	it("maps the rest of the brand onto company fields", () => {
		const update = brandToUpdate(brand, emptyCompany());

		expect(update).toMatchObject({
			description: "Payments infrastructure for the internet.",
			industry: "Finance",
			city: "South San Francisco",
			country: "United States",
			linkedinUrl: "https://linkedin.com/company/stripe",
		});
	});

	it("never overwrites a value a human already set", () => {
		const update = brandToUpdate(
			brand,
			emptyCompany({
				description: "Our biggest account — handle with care.",
				city: "London",
			}),
		);

		expect(update.description).toBeUndefined();
		expect(update.city).toBeUndefined();
		expect(update.country).toBe("United States");
	});

	it("leaves the name alone unless it is the domain placeholder", () => {
		expect(
			brandToUpdate(brand, emptyCompany({ name: "Stripe Inc" })).name,
		).toBeUndefined();

		expect(
			brandToUpdate(
				brand,
				emptyCompany({ name: "stripe.com", nameIsPlaceholder: true }),
			).name,
		).toBe("Stripe");
	});

	it("writes nothing when the lookup found nothing", () => {
		expect(brandToUpdate({}, emptyCompany())).toEqual({});
	});

	it("has no slogan fallback any more; the description is the description", () => {
		const update = brandToUpdate({ description: null }, emptyCompany());
		expect(update.description).toBeUndefined();
	});
});

describe("stillFillable", () => {
	it("drops a field a rep typed while the lookup was in flight", () => {
		const update = brandToUpdate(
			{
				description: "Payments infrastructure for the internet.",
				industry: "Finance",
			},
			emptyCompany(),
		);

		const data = stillFillable(
			update,
			emptyCompany({ description: "Our biggest account — handle with care." }),
		);

		expect(data.description).toBeUndefined();
		expect(data.industry).toBe("Finance");
	});

	it("keeps the icon, which the agent owns rather than shares", () => {
		const update = brandToUpdate(
			{ logoUrl: "https://cdn/logo.svg" },
			emptyCompany(),
		);

		const data = stillFillable(
			update,
			emptyCompany({ iconUrl: "https://acme.test/favicon.ico" }),
		);

		expect(data.iconUrl).toBe("https://cdn/logo.svg");
	});

	it("drops the name once the placeholder has been answered", () => {
		const update = brandToUpdate(
			{ title: "Stripe" },
			emptyCompany({ name: "stripe.com", nameIsPlaceholder: true }),
		);

		expect(update.name).toBe("Stripe");

		expect(
			stillFillable(update, emptyCompany({ name: "Stripe Inc" })).name,
		).toBeUndefined();
	});
});
