// The model the agent runs on. The old per-workspace model picker is gone: model choice is
// not a setting any more.
//
// eve requires a static fallback model id, and no Pramaan capability serves tool-calling
// generation yet (see SWAP-MAP.md, "llm.agent.run" gap). Until the lab ships one, this
// fallback is inert: no model credentials ship with the template, so every run reports that
// it cannot start rather than calling anybody.

export const AGENT_MODEL_FALLBACK = "anthropic/claude-sonnet-5";
