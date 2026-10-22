import type { Pramaan } from "@crm/pramaan";

export async function readPublicPage(api: Pramaan | null, url: string) {
	if (!api) return { ok: false as const, reason: "Pramaan is not configured." };
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" || parsed.username || parsed.password)
		throw new Error("Page reading requires a public HTTPS address.");
	const result = await api.webRead({ url: parsed.href });
	return {
		ok: true as const,
		url: result.url,
		content: result.text,
		truncated: result.truncated,
	};
}
