import { Global, Module } from "@nestjs/common";
import { AppsRouter } from "./apps.router";
import { AppsConnectionService } from "./apps-connection.service";
import {
	CompanyLogosController,
	LogoFilesController,
} from "./logo-files.controller";
import { PRAMAAN, PramaanClientProvider } from "./pramaan.constants";
import { StorageController } from "./storage.controller";

@Global()
@Module({
	providers: [
		PramaanClientProvider,
		{
			provide: PRAMAAN,
			useFactory: (provider: PramaanClientProvider) => provider.clientFromEnv(),
			inject: [PramaanClientProvider],
		},
		AppsConnectionService,
		AppsRouter,
	],
	controllers: [StorageController, LogoFilesController, CompanyLogosController],
	exports: [PRAMAAN, PramaanClientProvider, AppsConnectionService],
})
export class PramaanModule {}
