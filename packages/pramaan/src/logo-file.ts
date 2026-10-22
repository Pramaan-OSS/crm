import { z } from "zod";

export const LOGO_MAX_BYTES = 3 * 1024 * 1024;
export const workspaceFileId = z
	.string()
	.regex(/^file_[0-9A-HJKMNP-TV-Z]{26}$/);
export const workspaceLogo = z.object({
	fileId: workspaceFileId,
	contentType: z.enum([
		"image/png",
		"image/jpeg",
		"image/webp",
		"image/gif",
		"image/avif",
		"image/x-icon",
		"image/vnd.microsoft.icon",
	]),
	size: z.number().int().positive().max(LOGO_MAX_BYTES),
});
