import { Injectable } from "@nestjs/common";
import { SyncStateService } from "../mailbox/sync-state.service";
import {
	MICROSOFT_SYNC_SOURCES,
	type MicrosoftSyncSource,
} from "./microsoft.constants";
import { OutlookCalendarSyncService } from "./outlook-calendar-sync.service";
import { OutlookSyncService } from "./outlook-sync.service";

@Injectable()
export class MicrosoftSyncService {
	constructor(
		private readonly state: SyncStateService,
		private readonly outlook: OutlookSyncService,
		private readonly outlookCalendar: OutlookCalendarSyncService,
	) {}

	async runOne(userId: string, source: MicrosoftSyncSource) {
		const row = await this.state.get(userId, source);
		if (!row) return null;

		if (source === "outlook_calendar") return this.outlookCalendar.sync(row);
		return this.outlook.sync(row);
	}

	async runForUser(userId: string): Promise<void> {
		for (const source of MICROSOFT_SYNC_SOURCES) {
			await this.runOne(userId, source);
		}
	}
}
