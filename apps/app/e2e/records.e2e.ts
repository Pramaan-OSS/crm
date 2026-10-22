import { expect, test } from "@playwright/test";

import { seed, signIn, WORKSPACE } from "./helpers";

// Create a company, a contact and a deal through the UI, then reload: every
// record is still there.

test.describe(() => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test("a created company survives a reload", async ({ page }) => {
		await signIn(page);
		await page.goto(`/${WORKSPACE}/companies`);

		await page.getByRole("button", { name: "New company" }).click();
		await page.getByLabel("Name").fill("Reload Co");
		await page.getByLabel("Domain").fill("reload.example.test");
		await page
			.getByRole("dialog")
			.getByRole("button", { name: /add|create|save/i })
			.click();

		await page.waitForURL(/companies\/[a-zA-Z0-9_-]+$/);
		await page.reload();
		await expect(page.getByText("Reload Co").first()).toBeVisible();
	});

	test("a created contact survives a reload", async ({ page }) => {
		await signIn(page);
		await page.goto(`/${WORKSPACE}/contacts`);

		await page
			.getByRole("button", { name: /new contact/i })
			.first()
			.click();
		await page.getByLabel("First name").fill("Reload");
		await page.getByLabel("Last name").fill("Test");
		await page.getByLabel(/email/i).fill(`reload-${Date.now()}@example.test`);
		await page.getByRole("button", { name: "Add contact" }).click();

		await page.waitForURL(/contacts\/[a-zA-Z0-9_-]+$/);
		await page.reload();
		await expect(page.getByText("Reload Test").first()).toBeVisible();
	});

	test("a created deal survives a reload", async ({ page }) => {
		await signIn(page);
		await page.goto(`/${WORKSPACE}/deals`);

		await page
			.getByRole("button", { name: /new deal/i })
			.first()
			.click();
		await page.getByLabel("Name").fill(`Reload deal ${Date.now()}`);
		await page
			.getByRole("dialog")
			.getByRole("button", { name: /add|create|save/i })
			.click();

		await page.waitForURL(/deals\/[a-zA-Z0-9_-]+$/);
		await page.reload();
		await expect(page.getByText(/Reload deal/).first()).toBeVisible();
	});
});
