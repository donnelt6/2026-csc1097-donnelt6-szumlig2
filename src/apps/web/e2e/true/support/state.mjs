import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runtimeDir = path.resolve(__dirname, "..", ".runtime");
const stateFile = path.join(runtimeDir, "true-e2e-state.json");

function ensureRuntimeDir() {
  fs.mkdirSync(runtimeDir, { recursive: true });
}

function sanitize(value) {
  return String(value || "local")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "local";
}

export function getTrueE2ERunId() {
  return sanitize(
    process.env.CADDIE_TRUE_E2E_RUN_ID ||
    process.env.CI_JOB_ID ||
    process.env.CI_PIPELINE_ID ||
    "local"
  );
}

export function getTrueE2EStateFile() {
  return stateFile;
}

export function writeTrueE2EState(payload) {
  ensureRuntimeDir();
  fs.writeFileSync(stateFile, JSON.stringify(payload, null, 2));
}

export function readTrueE2EState() {
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

export function clearTrueE2EState() {
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
  }
}
