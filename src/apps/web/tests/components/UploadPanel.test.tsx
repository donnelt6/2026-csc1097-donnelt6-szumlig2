// Tests UploadPanel interactions with mocked API calls.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { UploadPanel } from "../../components/UploadPanel";
import {
  createSource,
  createYouTubeFallbackSource,
  createWebSource,
  createYouTubeSource,
  deleteSource,
  enqueueSource,
  failSource,
} from "../../lib/api";
import {
  MEDIA_COMPRESSION_INPUT_MAX_BYTES,
  prepareMediaFileForUpload,
} from "../../lib/mediaCompression";
import type { Source } from "@shared/index";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  createSource: vi.fn(),
  createYouTubeFallbackSource: vi.fn(),
  createWebSource: vi.fn(),
  createYouTubeSource: vi.fn(),
  listSourceSuggestions: vi.fn().mockResolvedValue([]),
  listSourceChunks: vi.fn().mockResolvedValue([]),
  decideSourceSuggestion: vi.fn(),
  deleteSource: vi.fn(),
  enqueueSource: vi.fn(),
  failSource: vi.fn(),
  refreshSource: vi.fn(),
}));

vi.mock("../../lib/mediaCompression", () => ({
  MEDIA_UPLOAD_MAX_BYTES: 50 * 1024 * 1024,
  MEDIA_COMPRESSION_INPUT_MAX_BYTES: 200 * 1024 * 1024,
  mediaUploadRequiresCompression: (file: File) => file.size > 50 * 1024 * 1024,
  prepareMediaFileForUpload: vi.fn(async (file: File) => file),
}));

function mockXhr(status = 200) {
  const instances: Array<{
    open: ReturnType<typeof vi.fn>;
    setRequestHeader: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    upload: { onprogress: ((e: unknown) => void) | null };
    onload: (() => void) | null;
    onerror: (() => void) | null;
    status: number;
  }> = [];

  vi.stubGlobal(
    "XMLHttpRequest",
    vi.fn(() => {
      const instance = {
        open: vi.fn(),
        setRequestHeader: vi.fn(),
        send: vi.fn(),
        upload: { onprogress: null as ((e: unknown) => void) | null },
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        status,
      };
      instance.send.mockImplementation(() => {
        setTimeout(() => instance.onload?.(), 0);
      });
      instances.push(instance);
      return instance;
    }),
  );

  return instances;
}

const buildSelectionProps = (overrides: Partial<ComponentProps<typeof UploadPanel>> = {}) => ({
  selectedSourceIds: [],
  onToggleSource: vi.fn(),
  onSelectAllSources: vi.fn(),
  onClearSourceSelection: vi.fn(),
  ...overrides,
});

describe("UploadPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows source skeleton rows while sources are loading", () => {
    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} sourcesLoading onRefresh={() => undefined} />
    );

    expect(screen.getByText("Source Name")).toBeInTheDocument();
    expect(screen.getByTestId("sources-row-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("sources-row-skeleton-4")).toBeInTheDocument();
    expect(screen.queryByText("No sources yet")).not.toBeInTheDocument();
  });

  it("uploads a file and enqueues processing", async () => {
    const onRefresh = vi.fn();
    vi.mocked(createSource).mockResolvedValue({
      source: {
        id: "src-1",
        hub_id: "hub-1",
        type: "file",
        original_name: "test.txt",
        status: "queued",
        created_at: "2025-01-01T00:00:00Z",
      },
      upload_url: "http://upload.test/file",
    });
    vi.mocked(enqueueSource).mockResolvedValue({ status: "queued" });
    mockXhr(200);

    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={onRefresh} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Source" }));

    const input = document.querySelector(".add-source-modal__file-input") as HTMLInputElement;
    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(createSource).toHaveBeenCalledWith({ hub_id: "hub-1", original_name: "test.txt" }),
      { timeout: 3000 }
    );
    await waitFor(() => expect(enqueueSource).toHaveBeenCalledWith("src-1"), { timeout: 3000 });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("limits accepted file extensions", async () => {
    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={() => undefined} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Source" }));

    const input = document.querySelector(".add-source-modal__file-input") as HTMLInputElement;
    expect(input.accept).toBe(".pdf,.docx,.txt,.md");
  });

  it("shows error in queue when upload fails", async () => {
    vi.mocked(createSource).mockResolvedValue({
      source: {
        id: "src-2",
        hub_id: "hub-1",
        type: "file",
        original_name: "bad.md",
        status: "queued",
        created_at: "2025-01-01T00:00:00Z",
      },
      upload_url: "http://upload.test/file",
    });
    mockXhr(500);

    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={vi.fn()} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Source" }));

    const input = document.querySelector(".add-source-modal__file-input") as HTMLInputElement;
    const file = new File(["oops"], "bad.md", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/Failed/i)).toBeInTheDocument(), { timeout: 3000 });
    expect(enqueueSource).not.toHaveBeenCalled();
    await waitFor(() => expect(failSource).toHaveBeenCalledWith("src-2", "Upload failed with status 500"));
  });

  it("does not delete a failed upload source when reopening the modal", async () => {
    vi.mocked(createSource).mockResolvedValue({
      source: {
        id: "src-2b",
        hub_id: "hub-1",
        type: "file",
        original_name: "bad-again.md",
        status: "queued",
        created_at: "2025-01-01T00:00:00Z",
      },
      upload_url: "http://upload.test/file",
    });
    mockXhr(500);

    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={vi.fn()} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Source" }));

    const input = document.querySelector(".add-source-modal__file-input") as HTMLInputElement;
    const file = new File(["oops"], "bad-again.md", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/Failed/i)).toBeInTheDocument(), { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Add Source" }));

    expect(deleteSource).not.toHaveBeenCalled();
  });

  it("shows error details for a failed source", async () => {
    const failedSource: Source = {
      id: "src-3",
      hub_id: "hub-1",
      type: "file",
      original_name: "retry.txt",
      status: "failed",
      created_at: "2025-01-01T00:00:00Z",
      failure_reason: "upload failed",
    };

    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[failedSource]} onRefresh={() => undefined} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View error" }));
    expect(screen.getByText("upload failed")).toBeInTheDocument();
  });

  it("shows manual upload fallback for eligible failed YouTube sources", async () => {
    const failedSource: Source = {
      id: "src-yt-failed",
      hub_id: "hub-1",
      type: "youtube",
      original_name: "youtube.com/abc123def45",
      status: "failed",
      created_at: "2025-01-01T00:00:00Z",
      failure_reason: "No captions available for this YouTube video",
      ingestion_metadata: {
        youtube_fallback_allowed: true,
        youtube_fallback_user_message: "Upload the audio or video file manually instead.",
      },
    };

    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[failedSource]} onRefresh={() => undefined} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View error" }));
    expect(screen.getByRole("button", { name: "Upload Video/Audio instead" })).toBeInTheDocument();
  });

  it("hides manual upload fallback when a recovery is already active", async () => {
    const failedSource: Source = {
      id: "src-yt-active",
      hub_id: "hub-1",
      type: "youtube",
      original_name: "youtube.com/abc123def45",
      status: "failed",
      created_at: "2025-01-01T00:00:00Z",
      failure_reason: "No captions available for this YouTube video",
      ingestion_metadata: {
        youtube_fallback_allowed: true,
        youtube_fallback_source_id: "src-fallback-1",
        youtube_fallback_source_status: "processing",
        youtube_fallback_user_message: "Upload the audio or video file manually instead.",
      },
    };

    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[failedSource]} onRefresh={() => undefined} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View error" }));
    expect(screen.queryByRole("button", { name: "Upload Video/Audio instead" })).not.toBeInTheDocument();
    expect(screen.getByText("Recovery processing")).toBeInTheDocument();
  });

  it("keeps manual upload fallback available while a recovery upload is only pending", async () => {
    const failedSource: Source = {
      id: "src-yt-pending",
      hub_id: "hub-1",
      type: "youtube",
      original_name: "youtube.com/abc123def45",
      status: "failed",
      created_at: "2025-01-01T00:00:00Z",
      failure_reason: "No captions available for this YouTube video",
      ingestion_metadata: {
        youtube_fallback_allowed: true,
        youtube_fallback_source_id: "src-fallback-1",
        youtube_fallback_source_status: "pending_upload",
        youtube_fallback_user_message: "Upload the audio or video file manually instead.",
      },
    };

    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[failedSource]} onRefresh={() => undefined} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View error" }));
    expect(screen.getByRole("button", { name: "Upload Video/Audio instead" })).toBeInTheDocument();
    expect(screen.getByText("Recovery upload pending")).toBeInTheDocument();
  });

  it("hides upload controls for viewers", () => {
    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={() => undefined} canUpload={false} />
    );

    expect(screen.queryByRole("button", { name: "Add Source" })).not.toBeInTheDocument();
    expect(screen.getByText(/view access/i)).toBeInTheDocument();
  });

  it("submits a URL for ingestion", async () => {
    const onRefresh = vi.fn();
    vi.mocked(createWebSource).mockResolvedValue({
      id: "src-web-1",
      hub_id: "hub-1",
      type: "web",
      original_name: "example.com",
      status: "queued",
      created_at: "2025-01-01T00:00:00Z",
    });

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[]} onRefresh={onRefresh} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Source" }));
    await user.click(screen.getByRole("button", { name: /Webpage Link/ }));
    await user.type(screen.getByPlaceholderText("https://example.com/article"), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(createWebSource).toHaveBeenCalledWith({ hub_id: "hub-1", url: "https://example.com" })
    );
    expect(onRefresh).toHaveBeenCalled();
  });

  it("submits a YouTube URL for ingestion", async () => {
    const onRefresh = vi.fn();
    vi.mocked(createYouTubeSource).mockResolvedValue({
      id: "src-yt-1",
      hub_id: "hub-1",
      type: "youtube",
      original_name: "youtube.com/abc123def45",
      status: "queued",
      created_at: "2025-01-01T00:00:00Z",
    });

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[]} onRefresh={onRefresh} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Source" }));
    await user.click(screen.getByRole("button", { name: /Video\/Audio/ }));
    await user.type(
      screen.getByPlaceholderText("https://youtube.com/watch?v=..."),
      "https://www.youtube.com/watch?v=abc123def45"
    );
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(createYouTubeSource).toHaveBeenCalledWith({
        hub_id: "hub-1",
        url: "https://www.youtube.com/watch?v=abc123def45",
        language: "en",
        allow_auto_captions: true,
      })
    );
    expect(onRefresh).toHaveBeenCalled();
  });

  it("does not enqueue the same YouTube URL twice on rapid repeat submit", async () => {
    const onRefresh = vi.fn();
    vi.mocked(createYouTubeSource).mockResolvedValue({
      id: "src-yt-1",
      hub_id: "hub-1",
      type: "youtube",
      original_name: "youtube.com/abc123def45",
      status: "queued",
      created_at: "2025-01-01T00:00:00Z",
    });

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[]} onRefresh={onRefresh} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Source" }));
    await user.click(screen.getByRole("button", { name: /Video\/Audio/ }));
    await user.type(
      screen.getByPlaceholderText("https://youtube.com/watch?v=..."),
      "https://www.youtube.com/watch?v=abc123def45"
    );

    const importButton = screen.getByRole("button", { name: "Import" });
    await user.dblClick(importButton);

    await waitFor(() => expect(createYouTubeSource).toHaveBeenCalledTimes(1));
  });

  it("submits a standalone manual media upload from the YouTube tab", async () => {
    const onRefresh = vi.fn();
    vi.mocked(createSource).mockResolvedValue({
      source: {
        id: "src-media-1",
        hub_id: "hub-1",
        type: "file",
        original_name: "clip.mp4",
        status: "queued",
        created_at: "2025-01-01T00:00:00Z",
        ingestion_metadata: { file_kind: "media", source_origin: "manual_media" },
      },
      upload_url: "http://upload.test/media",
    });
    vi.mocked(enqueueSource).mockResolvedValue({ status: "queued" });
    mockXhr(200);

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[]} onRefresh={onRefresh} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Source" }));
    await user.click(screen.getByRole("button", { name: /Video\/Audio/ }));
    expect(screen.getByText("Faster when captions are available; if import fails, you can upload media manually.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Upload audio\/video manually/i }));

    const input = document.querySelector(".add-source-modal__file-input") as HTMLInputElement;
    expect(input.accept).toBe(".mp3,.mp4,.m4a");
    expect(screen.getByText(/mp3, mp4, or m4a files\. files above 50mb are compressed before upload\./i)).toBeInTheDocument();
    const file = new File(["media"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(createSource).toHaveBeenCalledWith({
        hub_id: "hub-1",
        original_name: "clip.mp4",
        file_kind: "media",
      })
    );
    await waitFor(() => expect(enqueueSource).toHaveBeenCalledWith("src-media-1"));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("submits a YouTube fallback media upload", async () => {
    const onRefresh = vi.fn();
    vi.mocked(createYouTubeFallbackSource).mockResolvedValue({
      source: {
        id: "src-fallback-1",
        hub_id: "hub-1",
        type: "file",
        original_name: "lecture.mp4",
        status: "queued",
        created_at: "2025-01-01T00:00:00Z",
        ingestion_metadata: { source_origin: "youtube_fallback" },
      },
      upload_url: "http://upload.test/fallback",
    });
    vi.mocked(enqueueSource).mockResolvedValue({ status: "queued" });
    mockXhr(200);

    const failedSource: Source = {
      id: "src-yt-failed",
      hub_id: "hub-1",
      type: "youtube",
      original_name: "youtube.com/abc123def45",
      status: "failed",
      created_at: "2025-01-01T00:00:00Z",
      failure_reason: "No captions available for this YouTube video",
      ingestion_metadata: {
        youtube_fallback_allowed: true,
        youtube_fallback_user_message: "Upload the audio or video file manually instead.",
      },
    };

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[failedSource]} onRefresh={onRefresh} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View error" }));
    await user.click(screen.getByRole("button", { name: "Upload Video/Audio instead" }));

    const input = document.querySelector(".add-source-modal__file-input") as HTMLInputElement;
    expect(input.accept).toBe(".mp3,.mp4,.m4a");
    const file = new File(["media"], "lecture.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(createYouTubeFallbackSource).toHaveBeenCalledWith({
        hub_id: "hub-1",
        youtube_source_id: "src-yt-failed",
        original_name: "lecture.mp4",
      })
    );
    await waitFor(() => expect(enqueueSource).toHaveBeenCalledWith("src-fallback-1"));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("rejects manual media uploads above 50 MB before enqueueing", async () => {
    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[]} onRefresh={() => undefined} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Source" }));
    await user.click(screen.getByRole("button", { name: /Video\/Audio/ }));
    await user.click(screen.getByRole("button", { name: /Upload audio\/video manually/i }));

    const input = document.querySelector(".add-source-modal__file-input") as HTMLInputElement;
    const file = new File(["media"], "lecture.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: 60 * 1024 * 1024 });
    const compressed = new File(["compressed"], "lecture-speech.mp3", { type: "audio/mpeg" });
    vi.mocked(prepareMediaFileForUpload).mockResolvedValueOnce(compressed);
    vi.mocked(createSource).mockResolvedValue({
      source: {
        id: "src-media-2",
        hub_id: "hub-1",
        type: "file",
        original_name: "lecture-speech.mp3",
        status: "queued",
        created_at: "2025-01-01T00:00:00Z",
      },
      upload_url: "http://upload.test/file",
    });
    vi.mocked(enqueueSource).mockResolvedValue({ status: "queued" });
    mockXhr(200);

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(prepareMediaFileForUpload).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(createSource).toHaveBeenCalledWith({ hub_id: "hub-1", original_name: "lecture-speech.mp3", file_kind: "media" })
    );
    await waitFor(() => expect(enqueueSource).toHaveBeenCalledWith("src-media-2"));
  });

  it("rejects manual media uploads above the browser compression input limit before enqueueing", async () => {
    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[]} onRefresh={() => undefined} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Source" }));
    await user.click(screen.getByRole("button", { name: /Video\/Audio/ }));
    await user.click(screen.getByRole("button", { name: /Upload audio\/video manually/i }));

    const input = document.querySelector(".add-source-modal__file-input") as HTMLInputElement;
    const file = new File(["media"], "too-large.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: MEDIA_COMPRESSION_INPUT_MAX_BYTES + 1 });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/too-large\.mp4 exceeded the 200 mb raw size limit for browser compression/i)).toBeInTheDocument());
    expect(createSource).not.toHaveBeenCalled();
    expect(enqueueSource).not.toHaveBeenCalled();
  });

  it("shows delete for a non-failed source when uploads are allowed", () => {
    const source: Source = {
      id: "src-keep-1",
      hub_id: "hub-1",
      type: "file",
      original_name: "done.pdf",
      status: "complete",
      created_at: "2025-01-01T00:00:00Z",
    };

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[source]} onRefresh={() => undefined} />);

    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("confirms before deleting a source", async () => {
    const onRefresh = vi.fn();
    vi.mocked(deleteSource).mockResolvedValue(undefined);
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);

    const source: Source = {
      id: "src-delete-1",
      hub_id: "hub-1",
      type: "file",
      original_name: "keep.txt",
      status: "complete",
      created_at: "2025-01-01T00:00:00Z",
    };

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[source]} onRefresh={onRefresh} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteSource).not.toHaveBeenCalled();
  });

  it("deletes after confirmation", async () => {
    const onRefresh = vi.fn();
    vi.mocked(deleteSource).mockResolvedValue(undefined);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);

    const source: Source = {
      id: "src-delete-2",
      hub_id: "hub-1",
      type: "file",
      original_name: "drop.txt",
      status: "complete",
      created_at: "2025-01-01T00:00:00Z",
    };

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[source]} onRefresh={onRefresh} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteSource).toHaveBeenCalledWith("src-delete-2"));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("hides delete for viewers", () => {
    const source: Source = {
      id: "src-view-1",
      hub_id: "hub-1",
      type: "file",
      original_name: "view.txt",
      status: "complete",
      created_at: "2025-01-01T00:00:00Z",
    };

    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[source]} onRefresh={() => undefined} canUpload={false} />
    );

    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("shows refresh button for web sources", () => {
    const webSource: Source = {
      id: "src-web-2",
      hub_id: "hub-1",
      type: "web",
      original_name: "example.com",
      status: "complete",
      created_at: "2025-01-01T00:00:00Z",
    };

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[webSource]} onRefresh={() => undefined} />);

    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("hides refresh for YouTube sources with active recovery", () => {
    const source: Source = {
      id: "src-yt-recovery",
      hub_id: "hub-1",
      type: "youtube",
      original_name: "youtube.com/abc123def45",
      status: "failed",
      created_at: "2025-01-01T00:00:00Z",
      ingestion_metadata: {
        youtube_fallback_source_id: "src-fallback-1",
        youtube_fallback_source_status: "queued",
      },
    };

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[source]} onRefresh={() => undefined} />);

    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  it("renders selection toggles for complete sources and not for incomplete", () => {
    const completeSource: Source = {
      id: "src-complete-1",
      hub_id: "hub-1",
      type: "file",
      original_name: "done.pdf",
      status: "complete",
      created_at: "2025-01-01T00:00:00Z",
    };
    const processingSource: Source = {
      id: "src-processing-1",
      hub_id: "hub-1",
      type: "file",
      original_name: "processing.pdf",
      status: "processing",
      created_at: "2025-01-01T00:00:00Z",
    };

    renderWithQueryClient(
      <UploadPanel
        hubId="hub-1"
        sources={[completeSource, processingSource]}
        onRefresh={() => undefined}
        {...buildSelectionProps({ selectedSourceIds: ["src-complete-1"] })}
      />
    );

    const completeToggle = screen.getByRole("button", { name: /deselect done\.pdf/i });
    expect(completeToggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /processing\.pdf/i })).not.toBeInTheDocument();
  });

  it("calls selection callbacks from toggle and controls", async () => {
    const source: Source = {
      id: "src-select-1",
      hub_id: "hub-1",
      type: "file",
      original_name: "select.txt",
      status: "complete",
      created_at: "2025-01-01T00:00:00Z",
    };

    const selectionProps = buildSelectionProps({ selectedSourceIds: ["src-select-1"] });

    renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[source]} onRefresh={() => undefined} {...selectionProps} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /deselect select\.txt/i }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(selectionProps.onToggleSource).toHaveBeenCalledWith("src-select-1");
    expect(selectionProps.onClearSourceSelection).toHaveBeenCalled();
  });
});
