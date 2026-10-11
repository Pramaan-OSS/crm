import { storageBucket } from "@crm/db/blob";
import { idempotencyKey, type Pramaan } from "@crm/pramaan";
import {
	Controller,
	ForbiddenException,
	Get,
	Inject,
	Param,
	Res,
} from "@nestjs/common";
import type { Response } from "express";
import { InjectPramaan, PRAMAAN } from "./pramaan.constants";

const DOWNLOAD_TTL_SECONDS = 300;

/**
 * Serves mirrored images: mints a short-lived download link and redirects. The path is
 * content-addressed (a digest of the bytes), so the same image always lands on the same URL.
 */
@Controller("api/storage")
export class StorageController {
	constructor(@Inject(PRAMAAN) private readonly pramaan: Pramaan | null) {}

	@Get("*")
	async serve(
		@Param() params: { [key: string]: string },
		@Res() res: Response,
	) {
		if (!this.pramaan) {
			throw new ForbiddenException("Storage is not configured.");
		}

		const raw = params["0"] ?? "";
		const path = raw.replace(/^\/+/, "").replace(/[^A-Za-z0-9/._-]/g, "");
		if (!path || path.includes("..")) {
			throw new ForbiddenException("Not a storage path.");
		}

		const link = await this.pramaan.storageDownloadUrl(
			{
				bucket: storageBucket(),
				path,
				expiresIn: DOWNLOAD_TTL_SECONDS,
			},
			{ idempotencyKey: idempotencyKey() },
		);

		res.redirect(302, link.downloadUrl);
	}
}
