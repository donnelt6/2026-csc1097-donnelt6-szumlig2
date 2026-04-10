import { cleanupTrueE2E } from "./support/admin.mjs";
import { getTrueE2EStateFile } from "./support/state.mjs";
import fs from "node:fs";

if (fs.existsSync(getTrueE2EStateFile())) {
  await cleanupTrueE2E();
  console.log("Cleaned true E2E hub data.");
} else {
  console.log("No true E2E state file found. Skipping cleanup.");
}
