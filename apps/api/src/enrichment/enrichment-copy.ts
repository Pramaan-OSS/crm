import { MAX_ATTEMPTS, type TaskKind } from "@crm/db/agent-tasks";

export type EnrichmentQueueState = "running" | "queued" | "failed";

const STEPS = {
	brand: "Fetching the logo",
	portrait: "Finding their photo",
	"meeting-prep": "Getting ready for your meeting",
	identify: "Reading their profile",
	profile: "Reading their profile",
	recheck: "Checking for anything new",
	"company-profile": "Reading the company website",
	"workspace-profile": "Reading your own website",
	"field-backfill": "Filling in the blank details",
	"agent-event": "Reacting to a change",
} satisfies Record<TaskKind, string>;

const STEP_BY_KIND = new Map<string, string>(Object.entries(STEPS));

const UNKNOWN_STEP = "Looking them up";
const WAITING = "Waiting";
const GAVE_UP = "Could not look this up";
/** What the platform answers when the install's balance cannot cover the step. */
const CREDIT = "Not enough credit — top up to continue";

const SECOND_MS = 1_000;
const DAY_MS = 24 * 60 * 60 * SECOND_MS;
const DAYS_IN_WEEK = 7;
const DAYS_IN_MONTH = 30;
const WEEKS_FROM = 14;
const MONTHS_FROM = 60;

const TODAY = "Later today";
const TOMORROW = "Tomorrow";

export function enrichmentStep(kind: string): string {
	return STEP_BY_KIND.get(kind) ?? UNKNOWN_STEP;
}

export function enrichmentQueueState(
	attempts: number,
	leasedUntil: Date | null,
	now: Date,
): EnrichmentQueueState {
	if (leasedUntil !== null && leasedUntil.getTime() > now.getTime()) {
		return "running";
	}

	return attempts >= MAX_ATTEMPTS ? "failed" : "queued";
}

export function enrichmentQueueLine(
	state: EnrichmentQueueState,
	kind: string,
	outcome?: string | null,
): string {
	if (state === "queued") return WAITING;
	if (state === "failed") {
		if (outcome && /not enough credit/i.test(outcome)) return CREDIT;
		return GAVE_UP;
	}

	return enrichmentStep(kind);
}

export function enrichmentDueLabel(dueAt: Date, now: Date): string {
	const ahead = dueAt.getTime() - now.getTime();
	if (ahead < DAY_MS) return TODAY;

	const days = Math.floor(ahead / DAY_MS);
	if (days === 1) return TOMORROW;
	if (days < WEEKS_FROM) return `In ${days} days`;
	if (days < MONTHS_FROM) return `In ${Math.round(days / DAYS_IN_WEEK)} weeks`;

	return `In ${Math.round(days / DAYS_IN_MONTH)} months`;
}
