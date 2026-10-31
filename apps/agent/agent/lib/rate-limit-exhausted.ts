const exhausted = new WeakSet<object>();
export function markRateLimitExhausted(error: object): void {
	exhausted.add(error);
}
export function exhaustedRateLimit(error: unknown): boolean {
	return typeof error === "object" && error !== null && exhausted.has(error);
}
