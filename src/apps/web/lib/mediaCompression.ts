// mediaCompression.ts: Browser-side media preparation for uploads that exceed storage limits.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

export const MEDIA_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const MEDIA_COMPRESSION_INPUT_MAX_BYTES = 200 * 1024 * 1024;

const FFMPEG_CORE_BASE_PATH = "/ffmpeg";
const FFMPEG_CLASS_WORKER_PATH = "/ffmpeg/worker.js";

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

function _outputNameForCompressedUpload(inputName: string): string {
  const dotIndex = inputName.lastIndexOf(".");
  const stem = dotIndex > 0 ? inputName.slice(0, dotIndex) : inputName;
  return `${stem}-speech.mp3`;
}

function _assertFileFitsCompressionInputLimit(file: File): void {
  if (file.size > MEDIA_COMPRESSION_INPUT_MAX_BYTES) {
    throw new Error("File exceeded the 200 MB raw size limit for in-browser compression.");
  }
}

async function _loadFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    try {
      const origin = window.location.origin;
      const coreBaseUrl = `${origin}${FFMPEG_CORE_BASE_PATH}`;
      const classWorkerUrl = `${origin}${FFMPEG_CLASS_WORKER_PATH}`;
      await ffmpeg.load({
        classWorkerURL: classWorkerUrl,
        coreURL: await toBlobURL(`${coreBaseUrl}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${coreBaseUrl}/ffmpeg-core.wasm`, "application/wasm"),
      });
    } catch (error) {
      ffmpegLoadPromise = null;
      const detail = error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error);
      throw new Error(`Browser compression could not start: ${detail}`);
    }
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return ffmpegLoadPromise;
}

export function mediaUploadRequiresCompression(file: File): boolean {
  return file.size > MEDIA_UPLOAD_MAX_BYTES;
}

// Oversized media must be reduced in the browser before the direct storage upload begins.
export async function prepareMediaFileForUpload(file: File): Promise<File> {
  if (!mediaUploadRequiresCompression(file)) {
    return file;
  }

  _assertFileFitsCompressionInputLimit(file);

  const ffmpeg = await _loadFfmpeg();
  const inputName = file.name;
  const outputName = _outputNameForCompressedUpload(file.name);

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  await ffmpeg.exec([
    "-i",
    inputName,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "48k",
    "-map_metadata",
    "-1",
    outputName,
  ]);

  const output = await ffmpeg.readFile(outputName);
  if (!(output instanceof Uint8Array)) {
    throw new Error("Compressed media output could not be read.");
  }

  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  const blobBytes = new Uint8Array(output.length);
  blobBytes.set(output);
  const compressed = new File([blobBytes], outputName, {
    type: "audio/mpeg",
  });

  if (compressed.size > MEDIA_UPLOAD_MAX_BYTES) {
    throw new Error("Compressed media still exceeds the 50 MB upload limit. Trim the file and try again.");
  }

  return compressed;
}
