const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { createClient } = require("@supabase/supabase-js");

function readState() {
  const statePath = path.resolve(__dirname, ".runtime", "true-e2e-state.json");
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function createAdminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function findLatestSource(client, hubId, originalName) {
  const { data, error } = await client
    .from("sources")
    .select("id,original_name,status,failure_reason,created_at")
    .eq("hub_id", hubId)
    .eq("original_name", originalName)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw error;
  }
  return data?.[0] ?? null;
}

async function waitForSourceCompletion(client, hubId, originalName) {
  const seenStatuses = new Set();
  const timeoutAt = Date.now() + 180_000;

  while (Date.now() < timeoutAt) {
    // Poll the backend record directly so the test waits on ingestion state,
    // not on whichever intermediate UI status happens to be rendered next.
    const source = await findLatestSource(client, hubId, originalName);
    if (!source) {
      await pageWait(1_000);
      continue;
    }

    seenStatuses.add(source.status);
    if (source.status === "complete") {
      return source;
    }
    if (source.status === "failed") {
      throw new Error(
        `Source ingestion failed for ${originalName}. Seen statuses: ${[...seenStatuses].join(", ")}. ` +
        `Failure reason: ${source.failure_reason || "unknown failure"}`
      );
    }
    await pageWait(source.status === "queued" ? 1_000 : 2_500);
  }

  throw new Error(
    `Timed out waiting for ${originalName} to finish ingesting. Seen statuses: ${[...seenStatuses].join(", ") || "none"}`
  );
}

function pageWait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function ensureSourceSelected(page) {
  const toggle = page.getByRole("button", { name: /Sources \(\d+\/\d+\)/ });
  await expect(toggle).toBeVisible();
  const label = (await toggle.textContent()) || "";
  if (/Sources \(0\/\d+\)/.test(label)) {
    await toggle.click();
    // In the real UI this list can refresh while ingestion state settles, so
    // selecting the uploaded source by name is more stable than relying on
    // bulk actions like "Select all".
    const sourceButton = page.getByRole("button", { name: readState().fixtureFileName });
    await expect(sourceButton).toBeVisible();
    await sourceButton.click();
    await expect(toggle).not.toHaveText(/Sources \(0\/\d+\)/);
  }
}

test.describe.configure({ mode: "serial" });

test("real sign-in, upload, and grounded chat path works end to end", async ({ page }) => {
  const state = readState();
  const adminClient = createAdminClient();
  const fixturePath = path.resolve(__dirname, "fixtures", "true-e2e-knowledge.txt");
  const fixtureBuffer = fs.readFileSync(fixturePath);

  await page.goto("/auth");
  await page.getByLabel("Email").fill(state.email);
  await page.getByLabel("Password").fill(state.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/");
  await expect(page.getByRole("heading", { name: "Discover your knowledge archive." })).toBeVisible();

  await page.goto(`/hubs/${state.hubId}?tab=sources`);
  await expect(page.getByText("Hub Sources")).toBeVisible();
  await page.getByRole("button", { name: "Add Source" }).click();
  await page.locator(".add-source-modal__file-input").setInputFiles({
    name: state.fixtureFileName,
    mimeType: "text/plain",
    buffer: fixtureBuffer,
  });

  const source = await waitForSourceCompletion(adminClient, state.hubId, state.fixtureFileName);

  await page.reload();
  // The sources view can briefly contain both a static text row and the
  // interactive selectable row for the same source after reload.
  const sourceRow = page.locator(".sources__row", { hasText: state.fixtureFileName }).first();
  await expect(sourceRow).toBeVisible();
  await expect(sourceRow).toContainText("Complete");

  await page.goto(`/hubs/${state.hubId}?tab=chat`);
  await expect(page.getByLabel("Ask a question")).toBeVisible();
  await ensureSourceSelected(page);

  await page.getByLabel("Ask a question").fill(state.question);
  await page.getByLabel("Send message").click();

  const latestAnswer = page.locator(".chat__answer").last();
  await expect
    // Real chat completion is the slowest boundary in this flow, so poll for
    // actual answer text instead of assuming a fixed UI transition.
    .poll(async () => ((await latestAnswer.textContent()) || "").trim().length, {
      timeout: 180_000,
      intervals: [1_000, 2_000, 5_000],
      message: `Timed out waiting for chat response after source ${source.id} completed.`,
    })
    .toBeGreaterThan(0);

  const latestPair = page.locator(".chat__pair").last();
  await expect(latestPair.locator(".chat__citation-chip").first()).toBeVisible();
  await expect(latestPair.getByRole("button", { name: state.fixtureFileName })).toBeVisible();
});
