import { createHash } from "node:crypto";
import { LOGO_MAX_BYTES, type Pramaan, workspaceLogo } from "@crm/pramaan";
import { storageBaseUrl } from "./blob";
import { db } from "./client";

export function isLegacyLogo(value: string | null): boolean {
	if (!value) return false;
	try {
		return /^\/api\/logo-files\/file_[0-9A-HJKMNP-TV-Z]{26}$/.test(
			new URL(value, "http://local").pathname,
		);
	} catch {
		return false;
	}
}

export async function copyCompanyLogo(
	api: Pramaan,
	companyId: string,
	value: unknown,
): Promise<string | null> {
	const parsed = workspaceLogo.safeParse(value);
	const base = storageBaseUrl();
	if (!parsed.success || !base) return null;
	const logo = parsed.data;
	try {
		const response = await api.fileDownload(logo.fileId);
		const contentType = response.headers
			.get("content-type")
			?.split(";")[0]
			?.trim();
		const declared = response.headers.get("content-length");
		if (
			!response.ok ||
			!response.body ||
			contentType !== logo.contentType ||
			(declared !== null &&
				(!/^\d+$/.test(declared) || Number(declared) !== logo.size))
		) {
			await response.body?.cancel();
			return null;
		}
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > LOGO_MAX_BYTES || size > logo.size) return null;
				chunks.push(value);
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
		if (!size || size !== logo.size) return null;
		const bytes = Buffer.concat(chunks);
		const data = {
			sourceFileId: logo.fileId,
			contentType: logo.contentType,
			bytes,
			size,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
		await db.companyLogo.upsert({
			where: { companyId },
			create: { companyId, ...data },
			update: data,
		});
		return `${base}/api/company-logos/${encodeURIComponent(companyId)}`;
	} catch {
		return null;
	}
}
