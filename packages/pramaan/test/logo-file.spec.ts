import { expect, it } from "bun:test";
import { createPramaan } from "../src/index";

const id = "file_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const base = "https://workspace.test";
it("reads workspace metadata with the key and downloads without it", async () => {
	const calls: { url: string; init: RequestInit }[] = [];
	const api = createPramaan({
		apiKey: "fake-secret",
		baseUrl: base,
		fetch: async (url, init) => {
			calls.push({ url, init });
			if (calls.length === 1)
				return Response.json({
					fileId: id,
					contentType: "image/png",
					sizeBytes: 3,
					url: `${base}/files/${id}?signature=fake`,
				});
			return new Response(new Uint8Array([1, 2, 3]));
		},
	});
	expect((await api.fileDownload(id)).ok).toBe(true);
	expect(calls[0]?.url).toBe(`${base}/v1/files/${id}`);
	expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
		"Bearer fake-secret",
	);
	expect(new Headers(calls[1]?.init.headers).get("authorization")).toBeNull();
	expect(calls.every((c) => c.init.redirect === "error")).toBe(true);
});
for (const patch of [
	{ url: "https://other.test/file" },
	{ fileId: "file_01ARZ3NDEKTSV4RRFFQ69G5FAW" },
	{ contentType: "text/html" },
	{ sizeBytes: 4 * 1024 * 1024 },
	{ url: `${base}/other` },
])
	it(`refuses invalid workspace metadata ${JSON.stringify(patch)}`, async () => {
		let calls = 0;
		const api = createPramaan({
			apiKey: "fake",
			baseUrl: base,
			fetch: async () => {
				calls++;
				return Response.json({
					fileId: id,
					contentType: "image/png",
					sizeBytes: 3,
					url: `${base}/files/${id}?signature=fake`,
					...patch,
				});
			},
		});
		await expect(api.fileDownload(id)).rejects.toThrow();
		expect(calls).toBe(1);
	});
it("rejects bad ids without fetching", async () => {
	const api = createPramaan({
		apiKey: "fake",
		fetch: async () => {
			throw new Error("must not fetch");
		},
	});
	await expect(api.fileDownload("../secret")).rejects.toThrow();
});
