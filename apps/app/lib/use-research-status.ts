"use client";

// Whether research can run at all. The API answers from what the install has:
// the agent bridge (AGENT_BRIDGE_SECRET) and the platform key (PRAMAAN_API_KEY).
// When either is missing, every surface says so instead of queueing work that
// can never start.

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

export const RESEARCH_BLOCKED_MESSAGE =
	"Research needs a working PRAMAAN_API_KEY; ask the workspace owner to set it.";

export const BRIDGE_BLOCKED_MESSAGE =
	"Research needs the agent bridge configured (AGENT_BRIDGE_SECRET on the API); ask the workspace owner to set it.";

export function blockedResearchMessage(
	reason: "bridge" | "platform-key" | null | undefined,
): string {
	return reason === "bridge"
		? BRIDGE_BLOCKED_MESSAGE
		: RESEARCH_BLOCKED_MESSAGE;
}

export function useResearchStatus() {
	const trpc = useTRPC();
	const query = useQuery({
		...trpc.enrichment.status.queryOptions(undefined, {
			staleTime: Number.POSITIVE_INFINITY,
			refetchOnWindowFocus: false,
			retry: false,
		}),
	});

	const runnable = query.data?.runnable !== false;
	return {
		runnable,
		blocked: !runnable,
		reason: query.data?.reason ?? null,
		message: runnable ? null : blockedResearchMessage(query.data?.reason),
		ready: !query.isPending,
	};
}
