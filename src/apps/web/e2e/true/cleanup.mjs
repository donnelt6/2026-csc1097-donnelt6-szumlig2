import { cleanupTrueE2E } from "./support/admin.mjs";
import { getTrueE2EStateFile } from "./support/state.mjs";
import fs from "node:fs";

export default async function globalTeardown() {
  // Only clean up when setup produced state for this run. This keeps teardown
  // safe when setup fails early or Playwright aborts before initialization.
  if (fs.existsSync(getTrueE2EStateFile())) {
    await cleanupTrueE2E();
    console.log("Cleaned true E2E hub data.");
  } else {
    console.log("No true E2E state file found. Skipping cleanup.");
  }
}
