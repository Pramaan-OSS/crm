import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { copyCompanyLogo } from "@crm/db/company-logo";
import { LOGO_MAX_BYTES } from "@crm/pramaan";
import { FakePramaan } from "@crm/pramaan/fake";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { AuthGuard } from "@thallesp/nestjs-better-auth";
import request from "supertest";
import {
	CompanyLogosController,
	LogoFilesController,
} from "../src/pramaan/logo-files.controller";

const id = "file_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const fake = new FakePramaan();
const controller = new CompanyLogosController();
let companyId: string;
const metadata = { fileId: id, contentType: "image/png", size: 3 };
beforeAll(async () => {
	companyId = (
		await db.company.create({ data: { name: "Permanent logo test" } })
	).id;
});
afterAll(async () => {
	await db.company.delete({ where: { id: companyId } });
});

describe("permanent company logo files", () => {
	it("streams checked image bytes", async () => {
		fake.fileRoute = () =>
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "image/png", "content-length": "3" },
			});
		expect(await copyCompanyLogo(fake, companyId, metadata)).toContain(
			`/api/company-logos/${companyId}`,
		);
		const stored = await db.companyLogo.findUniqueOrThrow({
			where: { companyId },
		});
		expect(stored.size).toBe(3);
		expect(stored.sha256).toBe(
			"039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
		);
		fake.fileRoute = () => new Response(null, { status: 410 });
		const calls = fake.fileCalls.length;
		const file = await controller.serve(companyId);
		expect(fake.fileCalls.length).toBe(calls);
		expect(file.getHeaders().type).toBe("image/png");
		const chunks = [];
		for await (const chunk of file.getStream()) chunks.push(chunk);
		expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
		expect(fake.fileCalls.at(-1)).toBe(id);
	});
	it("rejects malformed ids before making calls", async () => {
		const count = fake.fileCalls.length;
		await expect(
			new LogoFilesController().serve("file_invalid"),
		).rejects.toThrow("Logo unavailable.");
		expect(fake.fileCalls).toHaveLength(count);
	});
	for (const [name, response] of [
		["missing file", () => new Response(null, { status: 404 })],
		[
			"non-image",
			() => new Response("html", { headers: { "content-type": "text/html" } }),
		],
		[
			"SVG",
			() =>
				new Response("<svg/>", {
					headers: { "content-type": "image/svg+xml" },
				}),
		],
		[
			"oversized declaration",
			() =>
				new Response("x", {
					headers: {
						"content-type": "image/png",
						"content-length": String(LOGO_MAX_BYTES + 1),
					},
				}),
		],
		[
			"oversized stream",
			() =>
				new Response(new Uint8Array(LOGO_MAX_BYTES + 1), {
					headers: { "content-type": "image/png" },
				}),
		],
		[
			"empty image",
			() => new Response("", { headers: { "content-type": "image/png" } }),
		],
		[
			"wrong size",
			() =>
				new Response("x", {
					headers: { "content-type": "image/png", "content-length": "2" },
				}),
		],
	] as const)
		it(`rejects ${name}`, async () => {
			fake.fileRoute = response;
			expect(await copyCompanyLogo(fake, companyId, metadata)).toBeNull();
		});
	it("handles download errors", async () => {
		fake.fileRoute = () => {
			throw new Error("private upstream error");
		};
		expect(await copyCompanyLogo(fake, companyId, metadata)).toBeNull();
	});
});

describe("logo HTTP authentication", () => {
	let app: INestApplication;
	beforeAll(async () => {
		const module = await Test.createTestingModule({
			controllers: [LogoFilesController, CompanyLogosController],
		}).compile();
		app = module.createNestApplication();
		app.useGlobalGuards(
			new AuthGuard(new Reflector(), {
				auth: {
					api: {
						getSession: async ({ headers }: { headers: Headers }) =>
							headers.get("cookie") === "test-session=valid"
								? { user: { id: "test" }, session: {} }
								: null,
					},
				},
			} as never),
		);
		await app.init();
	});
	afterAll(async () => {
		await app.close();
	});
	it("refuses anonymous requests without fetching files", async () => {
		const count = fake.fileCalls.length;
		await request(app.getHttpServer())
			.get(`/api/company-logos/${companyId}`)
			.expect(401);
		expect(fake.fileCalls).toHaveLength(count);
	});
	it("serves signed-in requests with private image headers", async () => {
		fake.fileRoute = () => {
			throw new Error("expired");
		};
		const count = fake.fileCalls.length;
		await request(app.getHttpServer())
			.get(`/api/company-logos/${companyId}`)
			.set("Cookie", "test-session=valid")
			.expect(200)
			.expect("Content-Type", "image/png")
			.expect("Cache-Control", "private, no-store")
			.expect("X-Content-Type-Options", "nosniff")
			.expect("Content-Security-Policy", "default-src 'none'; sandbox")
			.expect((response) => {
				expect(response.body).toEqual(Buffer.from([1, 2, 3]));
			});
		expect(fake.fileCalls).toHaveLength(count);
	});
	it("redirects old references only when a database copy exists", async () => {
		await request(app.getHttpServer()).get(`/api/logo-files/${id}`).expect(401);
		await request(app.getHttpServer())
			.get(`/api/logo-files/${id}`)
			.set("Cookie", "test-session=valid")
			.expect(302)
			.expect("Location", `/api/company-logos/${companyId}`);
		await request(app.getHttpServer())
			.get("/api/logo-files/file_01ARZ3NDEKTSV4RRFFQ69G5FAA")
			.set("Cookie", "test-session=valid")
			.expect(404);
	});
	it("returns unavailable for a missing company logo", async () => {
		await request(app.getHttpServer())
			.get("/api/company-logos/missing")
			.set("Cookie", "test-session=valid")
			.expect(404);
	});
});
