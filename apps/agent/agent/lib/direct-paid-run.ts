import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	assertCurrentRun,
	createSpendLedger,
	databaseScope,
	newPaidRun,
	type PaidRun,
	spendLedgerRoot,
} from "./run-safety";

export const directPaidRun = new AsyncLocalStorage<PaidRun>();

/** Direct background tasks have no Eve session; keep their allowance across re-leasing. */
export async function withDirectPaidRun<T>(
	taskId: string,
	work: () => Promise<T>,
): Promise<T> {
	const root = spendLedgerRoot();
	const key = createHash("sha256")
		.update(`${databaseScope()}:${taskId}`)
		.digest("hex");
	const path = join(root, `direct-${key}.json`);
	let run: PaidRun;
	if (existsSync(path)) {
		run = JSON.parse(readFileSync(path, "utf8")) as PaidRun;
	} else {
		run = newPaidRun();
		createSpendLedger(root, run);
		// Competing processes cannot overwrite an existing task's allowance.
		writeFileSync(path, JSON.stringify(run), { flag: "wx", mode: 0o600 });
	}
	assertCurrentRun(run);
	return directPaidRun.run(run, work);
}
