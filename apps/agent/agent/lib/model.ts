// The model the agent runs on. Generation goes through the `llm.chat` capability
// via the Pramaan client, and the platform picks the provider — this template
// never names a model or a provider, and model choice is not a setting.
//
// eve requires a static fallback model handle. When no Pramaan key is set the
// dynamic resolver declines, the fallback is used, and it fails the turn with a
// clear message: no model credentials ship with the template, so nothing calls
// out.

import type { Pramaan } from "@crm/pramaan";
import { defineDynamic } from "eve";

import { pramaan } from "./pramaan";
import { createPramaanChatModel } from "./pramaan-chat-model";

/** Context window advertised to eve for the platform model, in tokens. Conservative. */
const PLATFORM_CONTEXT_WINDOW_TOKENS = 200_000;

export const NO_KEY_MESSAGE =
	"Research needs a working PRAMAAN_API_KEY; ask the workspace owner to set it.";

/**
 * The fallback model handle: an AI SDK language model that fails any turn with
 * the setup message. It exists so eve's shape requirements hold without this
 * template naming a model or a provider.
 */
function unconfiguredModel(resolveClient: () => Pramaan | null) {
	const notConfigured = () => {
		throw new Error(
			resolveClient()
				? "The research model could not be resolved. Ask the workspace owner to check the research service."
				: NO_KEY_MESSAGE,
		);
	};
	return {
		specificationVersion: "v3" as const,
		provider: "pramaan-unconfigured",
		modelId: "needs-pramaan-api-key",
		supportedUrls: {},
		contextWindowTokens: PLATFORM_CONTEXT_WINDOW_TOKENS,
		doGenerate: notConfigured,
		doStream: notConfigured,
	};
}

export function agentModel(resolveClient: () => Pramaan | null = pramaan) {
	return defineDynamic({
		fallback: unconfiguredModel(resolveClient),
		events: {
			// A model object is not serializable, and eve only accepts one from a
			// step-scoped resolver; a session-scoped one is dropped for the fallback.
			"step.started": () => {
				const client = resolveClient();
				if (!client) return null;
				return {
					model: createPramaanChatModel({
						pramaan: client,
						tier: "best",
						contextWindowTokens: PLATFORM_CONTEXT_WINDOW_TOKENS,
					}),
				};
			},
		},
	});
}
