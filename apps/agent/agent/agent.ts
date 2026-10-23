import "@crm/env/load";

import { defineAgent } from "eve";
import { logCapabilities } from "./lib/capabilities";
import { agentModel } from "./lib/model";
import { validateRegisteredToolSchemas } from "./lib/registered-tools";

validateRegisteredToolSchemas();
void logCapabilities();

export default defineAgent({
	modelContextWindowTokens: 200_000,
	model: agentModel(),
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 50_000,
		sessionTimeoutMs: 30 * 24 * 60 * 60 * 1000,
	},
});
