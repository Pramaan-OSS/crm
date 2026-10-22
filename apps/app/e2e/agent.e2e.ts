import { expect, test } from "@playwright/test";

import { seed, signIn, WORKSPACE } from "./helpers";

// Research is not runnable on this install (no PRAMAAN_API_KEY): the company
// sheet and the agent panel must say so instead of showing Queued / Researching.

test.describe(() => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test("the company sheet says research is not set up and never shows queued", async ({
		page,
	}) => {
		const company = seed("company") as { id: string };
		await signIn(page);

		await page.goto(`/${WORKSPACE}/companies/${company.id}`);

		await expect(page.getByText("Research is not set up")).toBeVisible();
		await expect(page.getByText(/PRAMAAN_API_KEY/)).toBeVisible();
		await expect(page.getByText("Agent is researching")).toHaveCount(0);
		await expect(page.getByText("Queued")).toHaveCount(0);
	});
});
