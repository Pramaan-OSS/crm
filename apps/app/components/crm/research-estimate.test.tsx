import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchEstimate } from "./research-estimate";

for (const priceTypicalMicro of [undefined, 0, 2100])
	test(`research review typical ${priceTypicalMicro}`, async () => {
		const fake = {
			estimate: async () => ({
				needsConfirmation: true,
				priceMaxMicro: 4200,
				priceTypicalMicro,
			}),
		};
		const output = await fake.estimate();
		const html = renderToStaticMarkup(
			createElement(ResearchEstimate, { output }),
		);
		if (priceTypicalMicro === undefined) expect(html).toBe("");
		else {
			expect(html).toContain(
				`<strong>usually about $${(priceTypicalMicro / 1_000_000).toFixed(6)}</strong>`,
			);
			expect(html).toContain('<small class="block">at most $0.004200</small>');
		}
	});
