import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FaqPanel } from "../../components/FaqPanel";
import { listFaqs, updateFaq } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  listFaqs: vi.fn(),
  generateFaqs: vi.fn(),
  updateFaq: vi.fn(),
  archiveFaq: vi.fn(),
}));

describe("FaqPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("disables generation when no sources are selected", async () => {
    vi.mocked(listFaqs).mockResolvedValue([]);

    renderWithQueryClient(
      <FaqPanel hubId="hub-1" selectedSourceIds={[]} hasSelectableSources={true} canEdit={true} />
    );

    const button = screen.getByRole("button", { name: "Generate FAQs" });
    expect(button).toBeDisabled();
  });

  it("renders FAQs and allows pinning", async () => {
    vi.mocked(listFaqs).mockResolvedValue([
      {
        id: "faq-1",
        hub_id: "hub-1",
        question: "What is onboarding?",
        answer: "Answer [1]",
        citations: [{ source_id: "src-1", snippet: "Snippet" }],
        source_ids: ["src-1"],
        confidence: 0.8,
        is_pinned: false,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    vi.mocked(updateFaq).mockResolvedValue({
      id: "faq-1",
      hub_id: "hub-1",
      question: "What is onboarding?",
      answer: "Answer [1]",
      citations: [{ source_id: "src-1", snippet: "Snippet" }],
      source_ids: ["src-1"],
      confidence: 0.8,
      is_pinned: true,
      created_at: "2026-01-01T00:00:00Z",
    });

    renderWithQueryClient(
      <FaqPanel hubId="hub-1" selectedSourceIds={["src-1"]} hasSelectableSources={true} canEdit={true} />
    );

    await waitFor(() => expect(screen.getByText("What is onboarding?")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Pin" }));

    expect(updateFaq).toHaveBeenCalledWith("faq-1", { is_pinned: true });
  });
});
