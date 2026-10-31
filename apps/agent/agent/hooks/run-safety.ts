import { defineHook } from "eve/hooks";
import { paidRun } from "../lib/paid-run";
import {
	assertCurrentRun,
	createSpendLedger,
	newPaidRun,
	spendLedgerRoot,
} from "../lib/run-safety";

export default defineHook({
	events: {
		"session.started"() {
			if (paidRun.get() === null) {
				const run = newPaidRun();
				createSpendLedger(spendLedgerRoot(), run);
				paidRun.update(() => run);
			}
		},
		"step.started"() {
			assertCurrentRun(paidRun.get());
		},
		"actions.requested"() {
			assertCurrentRun(paidRun.get());
		},
	},
});
