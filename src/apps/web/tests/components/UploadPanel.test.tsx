// Tests UploadPanel interactions with mocked API calls.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { UploadPanel } from "../../components/UploadPanel";
import {
  createSource,
  createWebSource,
  createYouTubeSource,
  deleteSource,
  enqueueSource,
} from "../../lib/api";
import type { Source } from "../../lib/types";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  createSource: vi.fn(),
  createWebSource: vi.fn(),
  createYouTubeSource: vi.fn(),
  listSourceSuggestions: vi.fn().mockResolvedValue([]),
  listSourceChunks: vi.fn().mockResolvedValue([]),
  decideSourceSuggestion: vi.fn(),
  deleteSource: vi.fn(),
  enqueueSource: vi.fn(),
  refreshSource: vi.fn(),
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
    await user.click(screen.getByRole("button", { name: /YouTube Video/ }));
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

  it("renders selectable cards for complete sources and not for incomplete", () => {
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

    const completeCard = screen.getByRole("button", { name: /done\.pdf/ });
    expect(completeCard).toHaveAttribute("aria-pressed", "true");

    // Processing source should not have a button role (not selectable)
    expect(screen.queryByRole("button", { name: /processing\.pdf/ })).not.toBeInTheDocument();
  });

  it("calls selection callbacks from card click and controls", async () => {
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
    await user.click(screen.getByRole("button", { name: /select\.txt/ }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(selectionProps.onToggleSource).toHaveBeenCalledWith("src-select-1");
    expect(selectionProps.onClearSourceSelection).toHaveBeenCalled();
  });
});
