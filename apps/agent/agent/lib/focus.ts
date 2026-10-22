import { defineState } from "eve/context";

export const focus = defineState("crm.focus", () => ({
	contactId: null as string | null,
	companyId: null as string | null,
	sessionId: null as string | null,
	taskKind: null as string | null,
	spent: 0,
	budget: 4,
	exhausted: false,
	fresh: false,
}));

export type CurrentFocus = {
	contactId: string | null;
	sessionId: string | null;
	taskKind: string | null;
	fresh: boolean;
};

export function currentFocus(): CurrentFocus {
	try {
		const state = focus.get();
		return {
			contactId: state.contactId,
			sessionId: state.sessionId,
			taskKind: state.taskKind,
			fresh: state.fresh,
		};
	} catch {
		return {
			contactId: null,
			sessionId: null,
			taskKind: null,
			fresh: false,
		};
	}
}

/** Person-started runs may bypass the platform's answer copy; background runs may not. */
export function currentFresh(): boolean {
	try {
		return focus.get().fresh === true;
	} catch {
		return false;
	}
}

export function focusOn(input: {
	contactId?: string | null;
	companyId?: string | null;
	sessionId?: string | null;
	taskKind?: string | null;
	fresh?: boolean;
}): void {
	focus.update((current) => ({
		...current,
		contactId: input.contactId ?? current.contactId,
		companyId: input.companyId ?? current.companyId,
		sessionId: input.sessionId ?? current.sessionId,
		taskKind: input.taskKind ?? current.taskKind,
		fresh: input.fresh ?? current.fresh,
	}));
}

export function spend(units = 1): { ok: true } | { ok: false; reason: string } {
	const { spent, budget, exhausted } = focus.get();

	if (spent + units > budget) {
		if (!exhausted) {
			focus.update((current) => ({ ...current, exhausted: true }));
		}

		return {
			ok: false,
			reason:
				`Research budget for this contact is spent (${spent}/${budget}). ` +
				"Write up what you already have, or schedule a recheck with a reason. Do not keep looking.",
		};
	}

	focus.update((current) => ({ ...current, spent: current.spent + units }));
	return { ok: true };
}

export function setBudget(budget: number): void {
	focus.update((current) => ({ ...current, budget, exhausted: false }));
}
