import {
	MAX_ARCHIVE_RETENTION_DAYS,
	MIN_ARCHIVE_RETENTION_DAYS,
} from "@crm/db/settings";
import { z } from "zod";

export const archiveRetentionOutput = z.object({
	days: z.number(),
});

export type ArchiveRetentionSettings = z.infer<typeof archiveRetentionOutput>;

export const setArchiveRetentionDaysInput = z.object({
	days: z
		.number()
		.int()
		.min(
			MIN_ARCHIVE_RETENTION_DAYS,
			`Retention has to be at least ${MIN_ARCHIVE_RETENTION_DAYS} day.`,
		)
		.max(
			MAX_ARCHIVE_RETENTION_DAYS,
			`Retention cannot be longer than ${MAX_ARCHIVE_RETENTION_DAYS} days.`,
		),
});

export type SetArchiveRetentionDaysInput = z.infer<
	typeof setArchiveRetentionDaysInput
>;
