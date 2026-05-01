// Copies browser FFmpeg runtime assets into the web app's public folder for manual media upload compression.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "node_modules", "@ffmpeg", "core", "dist", "esm");
const classWorkerSourceDir = path.join(repoRoot, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm");
const targetDir = path.join(repoRoot, "apps", "web", "public", "ffmpeg");

if (!existsSync(sourceDir)) {
  throw new Error(`FFmpeg core assets not found at ${sourceDir}`);
}
if (!existsSync(classWorkerSourceDir)) {
  throw new Error(`FFmpeg worker assets not found at ${classWorkerSourceDir}`);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(path.join(sourceDir, "ffmpeg-core.js"), path.join(targetDir, "ffmpeg-core.js"));
copyFileSync(path.join(sourceDir, "ffmpeg-core.wasm"), path.join(targetDir, "ffmpeg-core.wasm"));
copyFileSync(path.join(classWorkerSourceDir, "worker.js"), path.join(targetDir, "worker.js"));
copyFileSync(path.join(classWorkerSourceDir, "const.js"), path.join(targetDir, "const.js"));
copyFileSync(path.join(classWorkerSourceDir, "errors.js"), path.join(targetDir, "errors.js"));
