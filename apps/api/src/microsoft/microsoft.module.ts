import { forwardRef } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { Module } from "@nestjs/common";
import { MailboxModule } from "../mailbox/mailbox.module";
import { TrpcModule } from "../trpc/trpc.module";
import { GraphClient } from "./graph.client";
import { MicrosoftRouter } from "./microsoft.router";
import { MicrosoftConnectionService } from "./microsoft-connection.service";
import { MicrosoftSyncService } from "./microsoft-sync.service";
import { OutlookCalendarSyncService } from "./outlook-calendar-sync.service";
import { OutlookSyncService } from "./outlook-sync.service";
import { SyncModule } from "../sync/sync.module";

@Module({
	imports: [AgentModule, TrpcModule, MailboxModule, forwardRef(() => SyncModule)],
	providers: [
		GraphClient,
		OutlookCalendarSyncService,
		OutlookSyncService,
		MicrosoftSyncService,
		MicrosoftConnectionService,
		MicrosoftRouter,
	],
	exports: [MicrosoftSyncService, MicrosoftConnectionService],
})
export class MicrosoftModule {}
