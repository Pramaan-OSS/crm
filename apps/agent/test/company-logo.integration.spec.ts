import { afterEach, expect, it } from "bun:test";
import { db } from "@crm/db";
import { copyCompanyLogo } from "@crm/db/company-logo";
import { LOGO_MAX_BYTES } from "@crm/pramaan";
import { FakePramaan } from "@crm/pramaan/fake";
import { runBrand } from "../agent/lib/brand";

const ids: string[] = [];
const metadata = {
	fileId: "file_01ARZ3NDEKTSV4RRFFQ69G5FAV",
	contentType: "image/png",
	size: 3,
};
async function company(legacy = false) {
	const row = await db.company.create({
		data: {
			name: "Logo fixture",
			domain: `logo-${crypto.randomUUID()}.test`,
			...(legacy
				? {
						logoUrl: `http://localhost/api/logo-files/${metadata.fileId}`,
						iconUrl: `http://localhost/api/logo-files/${metadata.fileId}`,
					}
				: {}),
		},
	});
	ids.push(row.id);
	return row;
}
afterEach(async () => {
	await db.company.deleteMany({ where: { id: { in: ids.splice(0) } } });
});
function fake() {
	const api = new FakePramaan({
		"companies.enrich": () => ({
			name: "Logo fixture",
			description: "Company facts",
		}),
	});
	api.routeOutcomes({
		get: () => ({ available: true }),
		estimate: () => ({
			canRun: true,
			requiresApproval: false,
			plan: "logo",
			steps: [],
			priceMinMicro: 0,
			priceMaxMicro: 0,
		}),
		run: () => ({ status: "done", result: { logoFile: metadata } }),
	});
	api.fileRoute = () =>
		new Response(new Uint8Array([1, 2, 3]), {
			headers: { "content-type": "image/png", "content-length": "3" },
		});
	return api;
}
it("persists a company URL and replaces a legacy logo and icon", async () => {
	const row = await company(true);
	const api = fake();
	await runBrand({ companyId: row.id, client: api });
	expect(
		(
			await runBrand({
				companyId: row.id,
				client: api,
				approval: { confirm: true, plan: "logo" },
			})
		).enriched,
	).toBe(true);
	const current = await db.company.findUniqueOrThrow({ where: { id: row.id } });
	expect(current.logoUrl).toContain(`/api/company-logos/${row.id}`);
	expect(current.iconUrl).toBe(current.logoUrl);
	expect(api.fileCalls).toHaveLength(1);
	expect(await db.companyLogo.count({ where: { companyId: row.id } })).toBe(1);
});
it("leaves logo fields empty when downloading fails, while retaining company facts", async () => {
	for (const legacy of [false, true]) {
		const row = await company(legacy);
		const api = fake();
		await runBrand({ companyId: row.id, client: api });
		api.fileRoute = () => {
			throw new Error("expired");
		};
		expect(
			(
				await runBrand({
					companyId: row.id,
					client: api,
					approval: { confirm: true, plan: "logo" },
				})
			).enriched,
		).toBe(true);
		const current = await db.company.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(current.logoUrl).toBeNull();
		expect(current.iconUrl).toBeNull();
		expect(current.description).toBe("Company facts");
		expect(await db.companyLogo.count({ where: { companyId: row.id } })).toBe(
			0,
		);
	}
});
it("upserts a single copy, retains valid bytes on failed replacement, and cascades deletion", async () => {
	const row = await company();
	const api = fake();
	await copyCompanyLogo(api, row.id, metadata);
	api.fileRoute = () =>
		new Response(new Uint8Array([4, 5, 6]), {
			headers: { "content-type": "image/png" },
		});
	await copyCompanyLogo(api, row.id, metadata);
	expect(await db.companyLogo.count({ where: { companyId: row.id } })).toBe(1);
	const stored = await db.companyLogo.findUniqueOrThrow({
		where: { companyId: row.id },
	});
	api.fileRoute = () => new Response(null, { status: 410 });
	expect(await copyCompanyLogo(api, row.id, metadata)).toBeNull();
	expect(
		(await db.companyLogo.findUniqueOrThrow({ where: { companyId: row.id } }))
			.sha256,
	).toBe(stored.sha256);
	await db.company.delete({ where: { id: row.id } });
	expect(await db.companyLogo.count({ where: { companyId: row.id } })).toBe(0);
});
it("rejects invalid metadata without a download", async () => {
	const row = await company();
	const api = fake();
	for (const value of [
		undefined,
		{ ...metadata, fileId: "../secret" },
		{ ...metadata, contentType: "image/svg+xml" },
		{ ...metadata, size: 0 },
		{ ...metadata, size: LOGO_MAX_BYTES + 1 },
	])
		expect(await copyCompanyLogo(api, row.id, value)).toBeNull();
	expect(api.fileCalls).toHaveLength(0);
});
it("rejects an outcome size mismatch and a response type mismatch", async () => {
	const row = await company();
	const api = fake();
	api.fileRoute = () =>
		new Response("xy", { headers: { "content-type": "image/png" } });
	expect(await copyCompanyLogo(api, row.id, metadata)).toBeNull();
	api.fileRoute = () =>
		new Response("xyz", { headers: { "content-type": "image/jpeg" } });
	expect(await copyCompanyLogo(api, row.id, metadata)).toBeNull();
	expect(await db.companyLogo.count({ where: { companyId: row.id } })).toBe(0);
});

it("preserves a manually supplied logo and icon", async () => {
	const row = await company();
	await db.company.update({
		where: { id: row.id },
		data: {
			logoUrl: "https://images.example.test/manual.png",
			iconUrl: "https://images.example.test/manual-icon.png",
		},
	});
	const api = fake();
	await runBrand({ companyId: row.id, client: api });
	await runBrand({
		companyId: row.id,
		client: api,
		approval: { confirm: true, plan: "logo" },
	});
	const current = await db.company.findUniqueOrThrow({ where: { id: row.id } });
	expect(current.logoUrl).toBe("https://images.example.test/manual.png");
	expect(current.iconUrl).toBe("https://images.example.test/manual-icon.png");
});
