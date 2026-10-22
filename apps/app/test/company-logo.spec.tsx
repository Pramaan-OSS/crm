import { describe, expect, it } from "bun:test";
import { companyLogoProps } from "@crm/db/images";
import { EntityLogo } from "@crm/ui/components/entity-logo";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyCell } from "../components/crm/company-cell";

const company = {
	id: "company-test",
	name: "Test Company",
	domain: "example.test",
	logoUrl: "http://localhost:3340/api/company-logos/company-test",
	iconUrl: "https://example.test/favicon.ico",
	iconDarkUrl: "https://example.test/dark.ico",
	iconTone: "light",
};

describe("company image preference", () => {
	it("renders the saved logo instead of either favicon in company chips", () => {
		const html = renderToStaticMarkup(<CompanyCell company={company} />);
		expect(html).toContain(company.logoUrl);
		expect(html).not.toContain("favicon.ico");
		expect(html).not.toContain("dark.ico");
		expect(html).not.toContain("dark:invert-0");
	});
	it("uses the logo's own dark variant when provided", () => {
		const html = renderToStaticMarkup(
			<EntityLogo
				name={company.name}
				{...companyLogoProps({
					...company,
					logoDarkUrl: "https://example.test/logo-dark.png",
				})}
			/>,
		);
		expect(html).toContain("logo-dark.png");
		expect(html).not.toContain("dark.ico");
	});
	it("renders the icon when the logo is absent or blank", () => {
		for (const logoUrl of [null, "", "  "]) {
			const html = renderToStaticMarkup(
				<CompanyCell company={{ ...company, logoUrl }} />,
			);
			expect(html).toContain(company.iconUrl);
			expect(html).toContain(company.iconDarkUrl);
		}
	});
	it("renders letters when neither image exists", () => {
		const html = renderToStaticMarkup(
			<CompanyCell
				company={{
					...company,
					logoUrl: null,
					iconUrl: null,
					iconDarkUrl: null,
				}}
			/>,
		);
		expect(html).not.toContain("<img");
		expect(html).toContain(">TC</span>");
	});
});
