import { PramaanError } from "@crm/pramaan";

export function requireCompleteReply(finishReason: string | undefined): void {
	if (finishReason === "length")
		throw new Error(
			"The reply is incomplete because it reached the reply limit. This step failed; retry it manually with a larger reply limit.",
		);
}
export function modelConfigurationError(error: unknown): unknown {
	if (
		error instanceof PramaanError &&
		error.code === "invalid_request" &&
		/maxTokens/i.test(error.message)
	)
		return new PramaanError(
			"invalid_request",
			`The reply limit is too small to produce an answer. Ask your administrator to increase the reply limit before retrying. ${error.message}${error.reason ? ` Reason: ${error.reason}.` : ""}${error.requestId ? ` Request: ${error.requestId}.` : ""}`,
			{
				status: error.status,
				retryable: false,
				requestId: error.requestId,
				reason: error.reason,
			},
		);
	return error;
}
