import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { MailboxSyncService } from "./mailbox-sync.service";

const INTERVAL_MS = 5 * 60 * 1000;
/** One tick at boot so a fresh install syncs without an outside cron. */
const BOOT_DELAY_MS = 10_000;

/**
 * The built-in sync scheduler: runs `MailboxSyncService.runDue()` every five
 * minutes, one run at a time, on by default. An outside cron can keep using
 * the CRON_SECRET route — set `SYNC_SCHEDULER=off` to turn this off and rely
 * on the outside cron alone.
 */
@Injectable()
export class SyncSchedulerService {
	private readonly logger = new Logger(SyncSchedulerService.name);

	private readonly enabled: boolean;

	constructor(
		private readonly sync: MailboxSyncService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.enabled = config.get("SYNC_SCHEDULER", { infer: true }) !== "off";
	}

	private timer: ReturnType<typeof setInterval> | null = null;
	private bootTimer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	/** True when the interval is scheduled (and the switch is on). */
	get scheduled(): boolean {
		return this.timer !== null;
	}

	start(): void {
		if (!this.enabled || this.timer) return;

		this.bootTimer = setTimeout(() => {
			void this.tick();
		}, BOOT_DELAY_MS);

		this.timer = setInterval(() => {
			void this.tick();
		}, INTERVAL_MS);

		this.logger.log({
			message: "Built-in sync scheduler started (every 5 minutes).",
		});
	}

	/** The interval body, exposed for tests: overlapping ticks collapse into the first. */
	async tick(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			const summary = await this.sync.runDue();
			if (summary.attempted > 0)
				this.logger.log({ message: "Scheduled sync ran", ...summary });
		} catch (error) {
			this.logger.error({
				message: "Scheduled sync failed",
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.running = false;
		}
	}

	stop(): void {
		if (this.bootTimer) clearTimeout(this.bootTimer);
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.bootTimer = null;
	}
}
