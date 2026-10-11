import { type Handoff, schemas } from "@crm/validation";

export function handoffResources(handoff: Handoff) {
	return [
		{
			kind: "integration" as const,
			id: "google:gmail",
			label: "Gmail",
			detail: "The rep's connected mailbox",
		},
		...(handoff.allowed.includes("history")
			? [
					{
						kind: "integration" as const,
						id: "google:calendar",
						label: "Google Calendar",
						detail: "The rep's connected calendar",
					},
				]
			: []),
	];
}

export function handoffBrief(handoff: Handoff): string {
	const lines = [`Build an agent named "${handoff.name}".`, handoff.job];

	lines.push(
		[
			"These permissions are already decided. Use exactly this list and do not ask about it:",
			...schemas.agents.permissions.map(
				(entry) =>
					`- ${entry.label}: ${handoff.allowed.includes(entry.id) ? "allowed" : "not allowed"}`,
			),
		].join("\n"),
	);

	return lines.join("\n\n");
}
