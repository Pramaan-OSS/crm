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
		if (
			!parsed.pathname.startsWith(STORAGE_PATH) &&
			!/^\/api\/logo-files\/file_[0-9A-HJKMNP-TV-Z]{26}$/.test(
				parsed.pathname,
			) &&
			!/^\/api\/company-logos\/[^/]+$/.test(parsed.pathname)
		)
			return false;

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

/** Keep the selected image's dark variant and tone together. */
export function companyLogoProps(
	company:
		| {
				logoUrl?: string | null;
				logoDarkUrl?: string | null;
				iconUrl?: string | null;
				iconDarkUrl?: string | null;
				iconTone?: string | null;
		  }
		| null
		| undefined,
): {
	src: string | null;
	darkSrc: string | null;
	tone: "opaque" | "dark" | "light" | null;
} {
	const logo = company?.logoUrl?.trim();
	const tone = company?.iconTone;
	return {
		src: logo || company?.iconUrl?.trim() || null,
		darkSrc: logo
			? (company?.logoDarkUrl ?? null)
			: (company?.iconDarkUrl ?? null),
		tone: logo
			? null
			: tone === "opaque" || tone === "dark" || tone === "light"
				? tone
				: null,
	};
}
