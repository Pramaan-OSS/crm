/** One ceiling for each research generation step, including streamed steps. */
export function researchStepMaxTokens(
	value = process.env.RESEARCH_MAX_TOKENS,
): number {
	const parsed =
		value === undefined || value.trim() === "" ? 4096 : Number(value);
	if (!Number.isInteger(parsed) || parsed < 64 || parsed > 8192)
		throw new Error(
			"RESEARCH_MAX_TOKENS must be a whole number from 64 to 8192.",
		);
	return parsed;
}
