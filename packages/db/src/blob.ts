import { createHash } from "node:crypto";
import { pramaanKeySet } from "@crm/pramaan";
import { isMirrored } from "./images";
import { safeFetch } from "./safe-fetch";

export { isMirrored, isOptimizable } from "./images";

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const PUT_TIMEOUT_MS = 30_000;

type ExtensionByMediaType = Record<string, string>;

const ALLOWED: ExtensionByMediaType = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/avif": "avif",
	"image/svg+xml": "svg",
	"image/x-icon": "ico",
	"image/vnd.microsoft.icon": "ico",
};

/**
 * The bucket every mirrored image lands in. One bucket keeps the template simple; set
 * PRAMAAN_STORAGE_BUCKET to move it.
 */
export function storageBucket(): string {
	return process.env.PRAMAAN_STORAGE_BUCKET?.trim() || "crm";
}

export function storageBaseUrl(): string {
	return process.env.APP_URL?.trim()?.replace(/\/+$/, "") ?? "";
}

export function storageEnabled(): boolean {
	return pramaanKeySet();
}

/**
 * Copy one image into Pramaan storage and return the URL this product serves it from:
 * `<APP_URL>/storage/<path>`, answered by the API with a fresh signed download link.
 * Returns the source URL untouched when it is already ours, and null when the copy fails.
 */
export async function mirror(
	sourceUrl: string,
	prefix: string,
): Promise<string | null> {
	if (!storageEnabled()) return null;
	if (isMirrored(sourceUrl)) return sourceUrl;

	try {
		const result = await safeFetch(sourceUrl, { timeoutMs: TIMEOUT_MS });
		if (!result?.response.ok) return null;

		const { response } = result;
		const type = response.headers.get("content-type")?.split(";")[0]?.trim();
		const extension = type ? ALLOWED[type.toLowerCase()] : undefined;
		if (!type || !extension) return null;

		const bytes = await readCapped(response);
		if (!bytes) return null;

		const digest = createHash("sha256")
			.update(bytes)
			.digest("hex")
			.slice(0, 12);

		const path = `${prefix}-${digest}.${extension}`;

		const { pramaanFromEnv, idempotencyKey } = await import("@crm/pramaan");
		const api = pramaanFromEnv();
		if (!api) return null;

		const upload = await api.storageUploadUrl(
			{ bucket: storageBucket(), path, overwrite: true },
			{ idempotencyKey: idempotencyKey() },
		);

		const put = await fetch(upload.uploadUrl, {
			method: "PUT",
			headers: { "content-type": type },
			body: new Uint8Array(bytes),
			signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
		});

		if (!put.ok) return null;

		const base = storageBaseUrl();
		if (!base) return null;

		return `${base}/api/storage/${path}`;
	} catch {
		return null;
	}
}

async function readCapped(response: Response): Promise<Buffer | null> {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_BYTES) {
		await response.body?.cancel();
		return null;
	}

	if (!response.body) return null;

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;

	try {
		while (size <= MAX_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			chunks.push(value);
		}
	} catch {
		return null;
	} finally {
		await reader.cancel().catch(() => {});
	}

	if (size === 0 || size > MAX_BYTES) return null;
	return Buffer.concat(chunks);
}
