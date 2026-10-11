import { agentError } from "@crm/telemetry";
import { defineHook } from "eve/hooks";
import { z } from "zod";
import { logCapabilities } from "../lib/capabilities";

void logCapabilities();

type SessionPrincipal = {
	readonly attributes?: Readonly<Record<string, string | readonly string[]>>;
} | null;

const attributeText = z.string().trim().min(1).nullable().catch(null);

function taskKind(auth: SessionPrincipal): string | null {
	return attributeText.parse(auth?.attributes?.taskKind);
}

export default defineHook({
	events: {
		"action.result"(event, ctx) {
			const { error, result, status } = event.data;
			if (status === "completed") return;

			agentError({
				error: error ?? status,
				tool: "toolName" in result ? result.toolName : null,
				taskKind: taskKind(ctx.session.auth.current ?? null),
				source: "tool",
			});
		},

		"turn.failed"(event, ctx) {
			agentError({
				error: event.data.code,
				taskKind: taskKind(ctx.session.auth.current ?? null),
				source: "turn",
			});
		},

		"session.failed"(event, ctx) {
			agentError({
				error: event.data.code,
				taskKind: taskKind(ctx.session.auth.current ?? null),
				source: "session",
			});
		},
	},
});
