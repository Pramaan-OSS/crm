import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { SettingsRouter } from "./settings.router";
import { SettingsService } from "./settings.service";

@Module({
	imports: [TrpcModule],
	providers: [SettingsService, SettingsRouter],
	exports: [SettingsService],
})
export class SettingsModule {}
