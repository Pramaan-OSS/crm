import { describe, expect, it } from "bun:test";

import { FakePramaan } from "@crm/pramaan/fake";
import { brandLogo } from "../agent/lib/brand-outcome";

describe("stored company logo", () => {
	it("requests workspace storage in both estimate and approved run", async () => {
		const fake = new FakePramaan();
		fake.routeOutcomes({
			get: () => ({ available: true }),
			estimate: () => ({
				plan: "logo",
				canRun: true,
				requiresApproval: true,
				priceMinMicro: 1,
				priceMaxMicro: 2,
				steps: [],
			}),
			run: () => ({
				status: "done",
				result: {
					logoFile: {
						fileId: "file_01ARZ3NDEKTSV4RRFFQ69G5FAV",
						contentType: "image/png",
						size: 3,
					},
				},
			}),
		});
		expect((await brandLogo(fake, "example.test")).state).toBe("estimate");
		expect(
			(await brandLogo(fake, "example.test", { confirm: true, plan: "logo" }))
				.state,
		).toBe("done");
		expect(
			fake.outcomeCalls
				.filter((c) => c.verb !== "get")
				.every(
					(c) =>
						JSON.stringify(c.opts?.options) ===
						JSON.stringify({ storeLogo: true }),
				),
		).toBe(true);
		expect(fake.calls).toHaveLength(0);
	});
});
