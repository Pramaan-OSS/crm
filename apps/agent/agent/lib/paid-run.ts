import { defineState } from "eve/context";
import type { PaidRun } from "./run-safety";

// Missing on legacy queued sessions: fail closed instead of assigning a fresh budget.
export const paidRun = defineState<PaidRun | null>("crm.paid-run", () => null);
