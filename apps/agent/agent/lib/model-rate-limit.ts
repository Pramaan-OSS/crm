import { PramaanError } from "@crm/pramaan";

export type WaitForModel = (milliseconds: number) => Promise<void>;
const MAX_WAITS = 2;
const MAX_WAIT_MS = 60_000;
const sleep: WaitForModel = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

function waitTime(error: unknown, waits: number): number | null {
	if (
		!(error instanceof PramaanError) ||
		error.code !== "rate_limited" ||
		!error.retryable ||
		waits >= MAX_WAITS
	)
		return null;
	const wait = error.retryAfterMs;
	// Never invent a delay or retry before a long server-requested delay expires.
	return typeof wait === "number" &&
		Number.isFinite(wait) &&
		wait >= 0 &&
		wait <= MAX_WAIT_MS
		? wait
		: null;
}
export async function withModelRateLimit<T>(
	call: () => Promise<T>,
	wait: WaitForModel = sleep,
): Promise<T> {
	for (let waits = 0; ; waits++) {
		try {
			return await call();
		} catch (error) {
			const milliseconds = waitTime(error, waits);
			if (milliseconds === null) throw error;
			await wait(milliseconds);
		}
	}
}
export async function* withStreamRateLimit<T>(
	open: () => AsyncGenerator<T>,
	wait: WaitForModel = sleep,
): AsyncGenerator<T> {
	for (let waits = 0; ; waits++) {
		let started = false;
		try {
			for await (const event of open()) {
				started = true;
				yield event;
			}
			return;
		} catch (error) {
			const milliseconds = waitTime(error, waits);
			if (started || milliseconds === null) throw error;
			await wait(milliseconds);
		}
	}
}
