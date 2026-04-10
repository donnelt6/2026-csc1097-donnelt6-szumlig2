import { cleanupTrueE2E } from "./support/admin.mjs";
import { getTrueE2EStateFile } from "./support/state.mjs";
import fs from "node:fs";

export default async function globalTeardown() {
  // Temporarily disabled so a true E2E run can be inspected afterward.
  // Restore cleanup before relying on this test as a repeatable release gate.
  if (fs.existsSync(getTrueE2EStateFile())) {
    console.log("True E2E cleanup is temporarily disabled. Leaving hub data in place.");
  } else {
    console.log("No true E2E state file found. Skipping cleanup.");
  }
}
