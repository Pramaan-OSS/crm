import { forwardRef, Module } from "@nestjs/common";
import { GoogleModule } from "../google/google.module";
import { MailboxModule } from "../mailbox/mailbox.module";
import { MicrosoftModule } from "../microsoft/microsoft.module";
import { MailboxSyncService } from "./mailbox-sync.service";
import { MAILBOX_SYNC } from "./mailbox-sync.token";
import { SyncController } from "./sync.controller";
import { SyncSchedulerService } from "./sync-scheduler.service";

@Module({
	imports: [
		MailboxModule,
		forwardRef(() => GoogleModule),
		forwardRef(() => MicrosoftModule),
	],
	controllers: [SyncController],
	providers: [
		MailboxSyncService,
		{ provide: MAILBOX_SYNC, useExisting: MailboxSyncService },
		SyncSchedulerService,
	],
	exports: [MailboxSyncService, SyncSchedulerService],
})
export class SyncModule {}
