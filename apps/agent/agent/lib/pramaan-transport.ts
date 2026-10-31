import { errorFromResponse, PramaanError } from "@crm/pramaan";
import { type WaitForModel, withModelRateLimit } from "./model-rate-limit";
import { markRateLimitExhausted } from "./rate-limit-exhausted";
import { assertCurrentRun, type PaidRun } from "./run-safety";

type Transport = (url: string, init: RequestInit) => Promise<Response>;
/** Covers capabilities, outcomes, streams and job reads at the one network boundary. */
export function agentTransport(options: {
	fetch: Transport;
	run: () => PaidRun | null;
	reserve: (run: PaidRun, amount: number) => void;
	wait?: WaitForModel;
}): Transport {
	async function request(url: string, init: RequestInit): Promise<Response> {
		try {
			return await withModelRateLimit(async () => {
				assertCurrentRun(options.run());
				const response = await options.fetch(url, init);
				if (!response.ok) throw await errorFromResponse(response);
				return response;
			}, options.wait);
		} catch (error) {
			if (error instanceof PramaanError && error.code === "rate_limited")
				markRateLimitExhausted(error);
			throw error;
		}
	}
	return async (url, init) => {
		const run = options.run();
		assertCurrentRun(run);
		const path = new URL(url).pathname;
		const paid =
			(init.method ?? "GET").toUpperCase() === "POST" &&
			/\/v1\/(capabilities|outcomes)\/[^/]+$/.test(path);
		if (!paid) return request(url, init);
		const headers = new Headers(init.headers);
		const estimateHeaders = new Headers(headers);
		estimateHeaders.delete("Idempotency-Key");
		estimateHeaders.delete("Pramaan-Plan");
		const estimate = await request(`${url}/estimate`, {
			...init,
			headers: estimateHeaders,
		});
		const cost = (await estimate.json()) as {
			price_max_micro?: unknown;
			plan?: unknown;
			requires_approval?: unknown;
		};
		if (
			typeof cost.price_max_micro !== "number" ||
			!Number.isSafeInteger(cost.price_max_micro) ||
			cost.price_max_micro < 0
		)
			throw new PramaanError(
				"invalid_request",
				"The research cost could not be bounded.",
			);
		if (path.includes("/v1/outcomes/")) {
			if (typeof cost.plan !== "string" || !cost.plan)
				throw new PramaanError(
					"invalid_request",
					"The research plan is missing.",
				);
			const approved = headers.get("Pramaan-Plan");
			if (cost.requires_approval === true && !approved)
				throw new PramaanError(
					"forbidden",
					"Review and approve the research plan before running it.",
				);
			if (approved && approved !== cost.plan)
				throw new PramaanError(
					"invalid_request",
					"The research plan changed. Review it before retrying.",
				);
			headers.set("Pramaan-Plan", cost.plan);
		} else {
			// The estimate includes the requested input and options; pin its ceiling on the paid call.
			headers.set(
				"Pramaan-Max-Price-Micro",
				String(Math.max(1, cost.price_max_micro)),
			);
		}
		options.reserve(
			run,
			path.includes("/v1/outcomes/")
				? cost.price_max_micro
				: Math.max(1, cost.price_max_micro),
		);
		return request(url, { ...init, headers });
	};
}
