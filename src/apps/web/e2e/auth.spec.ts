import { expect, test } from "@playwright/test";
import { createMockApiState, installMockApi, signIn } from "./fixtures/mockApi";

test("sign-in reaches the protected dashboard", async ({ page }) => {
  await installMockApi(page, createMockApiState());

  await signIn(page);

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: /Launch Hub/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "View all hubs" })).toBeVisible();
});
