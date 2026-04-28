import { expect, test } from "@playwright/test";
import { createMockApiState, installMockApi, signIn } from "./fixtures/mockApi";

test("upload reaches complete state in the sources UI", async ({ page }) => {
  await installMockApi(
    page,
    createMockApiState({
      sourcesByHub: {
        "hub-1": [],
      },
    }),
  );

  await signIn(page);
  await page.goto("/hubs/hub-1?tab=sources");
  await expect(page.getByText("Hub Sources")).toBeVisible();

  await page.getByRole("button", { name: "Add Source" }).click();
  await page.locator(".add-source-modal__file-input").setInputFiles({
    name: "lecture-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Important lecture notes for the mocked upload test."),
  });

  const sourceRow = page.locator(".sources__row", { hasText: "lecture-notes.txt" });
  await expect(sourceRow).toBeVisible();
  await expect(sourceRow).toContainText("Indexing");
  await expect(sourceRow).toContainText("Complete");
});
