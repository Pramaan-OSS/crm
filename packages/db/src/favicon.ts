import { safeFetch } from "./safe-fetch";

export { isBlockedAddress, resolvesToPublicHost } from "./safe-fetch";

const TIMEOUT_MS = 30_000;

/**
 * Resolve the icon for a company's own website through Pramaan: one structured read of the
 * page, falling back to the conventional path. The URL that comes back is verified later,
 * when the image is mirrored (a non-image is refused there by its content type).
 */
export async function resolveFavicon(
	domain: string | null | undefined,
): Promise<string | null> {
	if (!domain) return null;

	const base = `https://${domain}`;

	const extracted = await iconFromPage(base);
	const candidates = [...(extracted ? [extracted] : []), `${base}/favicon.ico`];

	for (const candidate of candidates) {
		if (await reachable(candidate)) return candidate;
	}

	return null;
}

async function iconFromPage(base: string): Promise<string | null> {
	try {
		const { firstText, pramaanFromEnv } = await import("@crm/pramaan");
		const api = pramaanFromEnv({
			PRAMAAN_API_KEY: process.env.PRAMAAN_API_KEY,
			PRAMAAN_BASE_URL: process.env.PRAMAAN_BASE_URL,
		});
		if (!api) return null;

		const response = await api.webExtract({
			url: base,
			schema: {
				type: "object",
				properties: {
					iconUrl: {
						type: "string",
						description:
							"The absolute URL of the site's favicon or apple-touch-icon.",
					},
				},
			},
			prompt:
				"Find this site's favicon. Report the absolute URL of the icon link " +
				"(rel icon, shortcut icon or apple-touch-icon) with the largest size.",
		});

		const iconUrl = firstText(response.data, ["iconUrl"]);
		if (!iconUrl) return null;

		return new URL(iconUrl, base).toString();
	} catch {
		return null;
	}
}

async function reachable(url: string): Promise<boolean> {
	try {
		const result = await safeFetch(url, {
			method: "HEAD",
			timeoutMs: TIMEOUT_MS,
		});
		if (!result?.response.ok) return false;

		await result.response.body?.cancel();
		return true;
	} catch {
		return false;
	}
}
