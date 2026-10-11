export const STORAGE_PATH = "/api/storage/";

export const COMPANY_IMAGE_FIELDS = [
	"logoUrl",
	"logoDarkUrl",
	"iconUrl",
	"iconDarkUrl",
] as const;

export type CompanyImageField = (typeof COMPANY_IMAGE_FIELDS)[number];

const OPTIMIZABLE = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);

export function isMirrored(url: string | null | undefined): boolean {
	if (!url) return false;
	try {
		const parsed = new URL(url);
		if (!parsed.pathname.startsWith(STORAGE_PATH)) return false;

		// Ours are served from this install's own origin; the same path on
		// somebody else's site is their image, not ours.
		const base = storageBaseUrl();
		if (!base) return true;
		return parsed.host === new URL(base).host;
	} catch {
		return false;
	}
}

function storageBaseUrl(): string {
	return process.env.APP_URL?.trim()?.replace(/\/+$/, "") ?? "";
}

export function isOptimizable(url: string | null | undefined): boolean {
	if (!isMirrored(url) || !url) return false;

	try {
		const extension = new URL(url).pathname.split(".").pop()?.toLowerCase();
		return extension !== undefined && OPTIMIZABLE.has(extension);
	} catch {
		return false;
	}
}
