import { expect, test } from "@playwright/test";

// A fresh install with no sign-in provider: the page must say there is no way in,
// point at the real setup (public client id + the exchange through PRAMAAN_API_KEY),
// and never mention a client secret.

test.describe(() => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test("with no key the page asks for PRAMAAN_API_KEY and nothing else", async ({
		page,
	}) => {
		await page.goto("/sign-in");

		await expect(page.getByText("Add PRAMAAN_API_KEY to .env")).toBeVisible();
		expect(await page.content()).not.toContain("CLIENT_SECRET");

		await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);
		await expect(page.getByRole("button", { name: /microsoft/i })).toHaveCount(
			0,
		);
	});
});
