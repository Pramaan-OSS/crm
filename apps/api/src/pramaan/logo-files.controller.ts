import { db } from "@crm/db";
import { LOGO_MAX_BYTES, workspaceFileId, workspaceLogo } from "@crm/pramaan";
import {
	Controller,
	Get,
	Header,
	NotFoundException,
	Param,
	Redirect,
	StreamableFile,
} from "@nestjs/common";

// Both routes use the application's global session guard.
@Controller("api/company-logos")
export class CompanyLogosController {
	@Get(":companyId")
	@Header("Cache-Control", "private, no-store")
	@Header("X-Content-Type-Options", "nosniff")
	@Header("Content-Security-Policy", "default-src 'none'; sandbox")
	async serve(@Param("companyId") companyId: string) {
		const logo = await db.companyLogo.findUnique({ where: { companyId } });
		if (
			!logo ||
			!workspaceLogo.safeParse({
				fileId: logo.sourceFileId,
				contentType: logo.contentType,
				size: logo.size,
			}).success ||
			logo.bytes.byteLength !== logo.size ||
			logo.size > LOGO_MAX_BYTES
		)
			throw new NotFoundException("Logo unavailable.");
		return new StreamableFile(Buffer.from(logo.bytes), {
			type: logo.contentType,
			length: logo.size,
			disposition: "inline",
		});
	}
}

@Controller("api/logo-files")
export class LogoFilesController {
	@Get(":fileId")
	@Redirect()
	@Header("Cache-Control", "private, no-store")
	@Header("X-Content-Type-Options", "nosniff")
	@Header("Content-Security-Policy", "default-src 'none'; sandbox")
	async serve(@Param("fileId") fileId: string) {
		if (!workspaceFileId.safeParse(fileId).success)
			throw new NotFoundException("Logo unavailable.");
		const logo = await db.companyLogo.findFirst({
			where: { sourceFileId: fileId },
			select: { companyId: true },
		});
		if (!logo) throw new NotFoundException("Logo unavailable.");
		return {
			url: `/api/company-logos/${encodeURIComponent(logo.companyId)}`,
			statusCode: 302,
		};
	}
}
