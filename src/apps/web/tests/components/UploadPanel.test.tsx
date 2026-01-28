// Tests UploadPanel interactions with mocked API calls and fetch.
import { QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadPanel } from "../../components/UploadPanel";
import { createSource, createSourceUploadUrl, enqueueSource, failSource } from "../../lib/api";
import type { Source } from "../../lib/types";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  createSource: vi.fn(),
  createSourceUploadUrl: vi.fn(),
  deleteSource: vi.fn(),
  enqueueSource: vi.fn(),
  failSource: vi.fn(),
}));

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

  it("disables uploads for viewers", () => {
    // Expect inputs and upload button to be disabled for view-only users.
    const { container } = renderWithQueryClient(
      <UploadPanel hubId="hub-1" sources={[]} onRefresh={() => undefined} canUpload={false} />
    );

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    expect(screen.getByText(/view access/i)).toBeInTheDocument();
  });
});
