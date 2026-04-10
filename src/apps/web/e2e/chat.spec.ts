import { expect, test } from "@playwright/test";
import { createMockApiState, installMockApi, signIn } from "./fixtures/mockApi";

test("chat question renders an answer with citations", async ({ page }) => {
  await installMockApi(page, createMockApiState());

  await signIn(page);
  await page.goto("/hubs/hub-1?tab=chat");

  await expect(page.getByLabel("Ask a question")).toBeVisible();
  await page.getByLabel("Ask a question").fill("What should I review first?");
  await page.getByLabel("Send message").click();

  await expect(page.getByText("Mocked answer for: What should I review first?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Module Handbook.pdf" })).toBeVisible();
});
