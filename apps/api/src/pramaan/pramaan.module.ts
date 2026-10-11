import { Global, Module } from "@nestjs/common";
import { AppsConnectionService } from "./apps-connection.service";
import {
	InjectPramaan,
	PRAMAAN,
	PramaanClientProvider,
} from "./pramaan.constants";
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
	],
	controllers: [StorageController],
	exports: [PRAMAAN, PramaanClientProvider, AppsConnectionService],
})
export class PramaanModule {}
