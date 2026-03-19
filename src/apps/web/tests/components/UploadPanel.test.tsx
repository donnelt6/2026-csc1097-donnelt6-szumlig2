// Tests UploadPanel interactions with mocked API calls and fetch.
import { QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { UploadPanel } from "../../components/UploadPanel";
import {
  createSource,
  createSourceUploadUrl,
  createWebSource,
  createYouTubeSource,
  deleteSource,
  enqueueSource,
  failSource,
} from "../../lib/api";
import type { Source } from "../../lib/types";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  createSource: vi.fn(),
  createSourceUploadUrl: vi.fn(),
  createWebSource: vi.fn(),
  createYouTubeSource: vi.fn(),
  deleteSource: vi.fn(),
  enqueueSource: vi.fn(),
  failSource: vi.fn(),
  refreshSource: vi.fn(),
}));

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
    // Expect the upload pipeline to call createSource, fetch, enqueue, and refresh.
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

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    const { container } = renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={onRefresh} />
    );

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["hello"], "test.txt", { type: "text/plain" });

    const user = userEvent.setup();
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(createSource).toHaveBeenCalledWith({ hub_id: "hub-1", original_name: "test.txt" })
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://upload.test/file",
      expect.objectContaining({ method: "PUT" })
    );
    await waitFor(() => expect(enqueueSource).toHaveBeenCalledWith("src-1"));
    expect(onRefresh).toHaveBeenCalled();
    expect(await screen.findByText(/Upload enqueued/)).toBeInTheDocument();
  });

  it("limits accepted file extensions", () => {
    const { container } = renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={() => undefined} />
    );

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(input.accept).toBe(".pdf,.docx,.txt,.md");
  });

  it("marks the source failed when upload fails", async () => {
    const onRefresh = vi.fn();
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
    vi.mocked(failSource).mockResolvedValue({
      id: "src-2",
      status: "failed",
      failure_reason: "invalid mime type",
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve("invalid mime type"),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { container } = renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={onRefresh} />
    );

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["oops"], "bad.md", { type: "" });

    const user = userEvent.setup();
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(failSource).toHaveBeenCalledWith("src-2", "invalid mime type"));
    expect(enqueueSource).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
    expect(await screen.findByText(/invalid mime type/i)).toBeInTheDocument();
  });

  it("retries a failed upload with the original file", async () => {
    const onRefresh = vi.fn();
    vi.mocked(createSource).mockResolvedValue({
      source: {
        id: "src-3",
        hub_id: "hub-1",
        type: "file",
        original_name: "retry.txt",
        status: "queued",
        created_at: "2025-01-01T00:00:00Z",
      },
      upload_url: "http://upload.test/file",
    });
    vi.mocked(failSource).mockResolvedValue({
      id: "src-3",
      status: "failed",
      failure_reason: "upload failed",
    });
    vi.mocked(createSourceUploadUrl).mockResolvedValue({ upload_url: "http://upload.test/retry" });
    vi.mocked(enqueueSource).mockResolvedValue({ status: "queued" });

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, text: () => Promise.resolve("upload failed") })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    const file = new File(["retry"], "retry.txt", { type: "text/plain" });
    const failedSource: Source = {
      id: "src-3",
      hub_id: "hub-1",
      type: "file",
      original_name: "retry.txt",
      status: "failed",
      created_at: "2025-01-01T00:00:00Z",
      failure_reason: "upload failed",
    };

    const { container, rerender, queryClient } = renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={onRefresh} />
    );

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(failSource).toHaveBeenCalledWith("src-3", "upload failed"));

    rerender(
      <QueryClientProvider client={queryClient}>
        <UploadPanel hubId="hub-1" sources={[failedSource]} onRefresh={onRefresh} />
      </QueryClientProvider>
    );

    await user.click(screen.getByRole("button", { name: "Retry upload" }));

    await waitFor(() => expect(createSourceUploadUrl).toHaveBeenCalledWith("src-3"));
    await waitFor(() => expect(enqueueSource).toHaveBeenCalledWith("src-3"));
    expect(fetchSpy.mock.calls[1][1]?.body).toBe(file);
    expect(await screen.findByText(/Upload requeued/i)).toBeInTheDocument();
  });

  it("hides upload card for viewers", () => {
    // Upload card is hidden entirely for view-only users; only permission notice shown.
    const { container } = renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={() => undefined} canUpload={false} />
    );

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
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
    await user.type(screen.getByPlaceholderText("https://example.com/..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Add URL" }));

    await waitFor(() =>
      expect(createWebSource).toHaveBeenCalledWith({ hub_id: "hub-1", url: "https://example.com" })
    );
    expect(onRefresh).toHaveBeenCalled();
    expect(await screen.findByText(/URL enqueued/i)).toBeInTheDocument();
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
    await user.type(
      screen.getByPlaceholderText("https://youtube.com/watch?v=..."),
      "https://www.youtube.com/watch?v=abc123def45"
    );
    await user.click(screen.getByRole("button", { name: "Add YouTube" }));

    await waitFor(() =>
      expect(createYouTubeSource).toHaveBeenCalledWith({
        hub_id: "hub-1",
        url: "https://www.youtube.com/watch?v=abc123def45",
        language: null,
        allow_auto_captions: true,
      })
    );
    expect(onRefresh).toHaveBeenCalled();
    expect(await screen.findByText(/YouTube video enqueued/i)).toBeInTheDocument();
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

  it("disables reprocess until a web crawl succeeds", () => {
    const webSource: Source = {
      id: "src-web-2",
      hub_id: "hub-1",
      type: "web",
      original_name: "example.com",
      status: "complete",
      created_at: "2025-01-01T00:00:00Z",
      ingestion_metadata: {},
    };

    renderWithQueryClient(<UploadPanel hubId="hub-1" sources={[webSource]} onRefresh={() => undefined} />);

    const reprocess = screen.getByRole("button", { name: "Reprocess" });
    expect(reprocess).toBeDisabled();
    expect(screen.getByText(/first successful ingest/i)).toBeInTheDocument();
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
