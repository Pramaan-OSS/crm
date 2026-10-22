import type { EnrichmentStatus } from "@crm/db/enums";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { enrichmentPresentation } from "@/lib/enrichment-status";

export function EnrichmentIndicator({
	status,
	queued = false,
	blocked = false,
	title,
	className,
}: {
	status: EnrichmentStatus;
	queued?: boolean;
	/** Research cannot run on this install: never show Queued/Researching. */
	blocked?: boolean;
	title?: string | null;
	className?: string;
}) {
	const { label, tone, busy } = enrichmentPresentation(status, queued, blocked);

	return (
		<StatusIndicator
			tone={tone}
			busy={busy}
			label={label}
			title={title ?? undefined}
			className={className}
		/>
	);
}
