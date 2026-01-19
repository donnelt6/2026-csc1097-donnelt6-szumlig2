// Tests UploadPanel interactions with mocked API calls and fetch.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadPanel } from "../../components/UploadPanel";
import { createSource, enqueueSource } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  createSource: vi.fn(),
  enqueueSource: vi.fn(),
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
