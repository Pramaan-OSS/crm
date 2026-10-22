import { ensureManagedBackend, trustedOrigins } from "@crm/auth";
import {
	ensureDatabaseUrl,
	managedDatabaseFallbackLine,
} from "@crm/db/managed";
import { pramaanFromEnv } from "@crm/pramaan";
import { Logger } from "@nestjs/common";
import { createApp } from "./create-app";
import { SyncSchedulerService } from "./sync/sync-scheduler.service";

async function bootstrap() {
	const logger = new Logger("Bootstrap");

	// Managed database and managed sign-in, provisioned (or reused) before any
	// server opens: both are idempotent, and neither prints a secret.
	const dbOutcome = await ensureDatabaseUrl();
	const fallbackLine = managedDatabaseFallbackLine(dbOutcome);
	if (fallbackLine) logger.warn(fallbackLine);

	const backend = await ensureManagedBackend(pramaanFromEnv());
	if (backend) {
		logger.log("Managed sign-in is available for this install.");
	}

	const app = await createApp();
	app.enableShutdownHooks();

	const scheduler = app.get(SyncSchedulerService);
	scheduler.start();
	process.on("SIGTERM", () => scheduler.stop());
	process.on("SIGINT", () => scheduler.stop());

	const port = process.env.PORT ?? 3001;
	await app.listen(port);

	logger.log({
		message: `API listening on http://localhost:${port}`,
		port: Number(port),
		environment: process.env.NODE_ENV ?? "development",
	});

	// A sign-in POST whose Origin is not on this list is refused with 403, so a
	// port or host mismatch is visible here at startup instead of at sign-out.
	logger.log({
		message: `Sign-in is trusted from: ${trustedOrigins.join(", ")}`,
	});
	if (!backend) {
		logger.log({
			message:
				"Managed sign-in is not available — set PRAMAAN_API_KEY, or configure a sign-in provider of your own.",
		});
	}
}

void bootstrap().catch((cause: unknown) => {
	new Logger("Bootstrap").fatal(
		{ message: "API failed to start" },
		cause instanceof Error ? cause.stack : String(cause),
	);
	process.exit(1);
});
