import { expect, it } from "bun:test";
import { PramaanClient } from "../src/sdk/client";
import { PramaanError } from "../src/sdk/errors";

it("preserves forbidden approval_required, plan and needs without retrying a run", async () => {
	let calls = 0;
	const client = new PramaanClient({
		apiKey: "fake",
		fetch: async () => {
			calls++;
			return Response.json(
				{
					error: {
						code: "forbidden",
						reason: "approval_required",
						message: "Approval required",
						plan: { id: "review-plan" },
						needs: [{ step: "store" }],
					},
				},
				{ status: 403 },
			);
		},
	});
	try {
		await client.outcomes.run(
			"company.brand.kit",
			{ domain: "example.test" },
			{
				options: { storeLogo: true },
				idempotencyKey: "fixture",
			},
		);
		expect.unreachable();
	} catch (error) {
		expect(error).toBeInstanceOf(PramaanError);
		const refusal = error as PramaanError;
		expect(refusal.code).toBe("forbidden");
		expect(refusal.reason).toBe("approval_required");
		expect(refusal.plan).toEqual({ id: "review-plan" });
		expect(refusal.needs).toEqual([{ step: "store" }]);
	}
	expect(calls).toBe(1);
});
