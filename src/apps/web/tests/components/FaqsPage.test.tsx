import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FaqsPage } from "../../components/hub-dashboard/FaqsPage";
import { listFaqs } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  archiveFaq: vi.fn(),
  askQuestion: vi.fn(),
  createFaq: vi.fn(),
  flagFaq: vi.fn(),
  generateFaqs: vi.fn(),
  listFaqs: vi.fn(),
  updateFaq: vi.fn(),
}));

describe("FaqsPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders AI topic pills only for labels that meet the threshold and filters results", async () => {
    vi.mocked(listFaqs).mockResolvedValue([
      {
        id: "faq-1",
        hub_id: "hub-1",
        question: "HR Question 1",
        answer: "Answer [1]",
        topic_label: "HR",
        topic_labels: ["HR", "Security"],
        citations: [],
        source_ids: ["src-1"],
        confidence: 0.8,
        is_pinned: false,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "faq-2",
        hub_id: "hub-1",
        question: "HR Question 2",
        answer: "Answer [1]",
        topic_label: "HR",
        topic_labels: ["HR", "Security"],
        citations: [],
        source_ids: ["src-1"],
        confidence: 0.8,
        is_pinned: true,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "faq-3",
        hub_id: "hub-1",
        question: "HR Question 3",
        answer: "Answer [1]",
        topic_label: "HR",
        topic_labels: ["HR", "Security"],
        citations: [],
        source_ids: ["src-1"],
        confidence: 0.8,
        is_pinned: false,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "faq-4",
        hub_id: "hub-1",
        question: "Payroll Question",
        answer: "Answer [1]",
        topic_label: "Payroll",
        topic_labels: ["Payroll", "Security"],
        citations: [],
        source_ids: ["src-1"],
        confidence: 0.8,
        is_pinned: false,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    renderWithQueryClient(<FaqsPage hubId="hub-1" sources={[]} canEdit={false} />);

    await waitFor(() => expect(screen.getByText("HR Question 1")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "HR (3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Security (4)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Payroll (1)" })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "HR (3)" }));

    expect(screen.getByText("HR Question 1")).toBeInTheDocument();
    expect(screen.getByText("HR Question 2")).toBeInTheDocument();
    expect(screen.getByText("HR Question 3")).toBeInTheDocument();
    expect(screen.queryByText("Payroll Question")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Security (4)" }));

    expect(screen.getByText("HR Question 1")).toBeInTheDocument();
    expect(screen.getByText("HR Question 2")).toBeInTheDocument();
    expect(screen.getByText("HR Question 3")).toBeInTheDocument();
    expect(screen.getByText("Payroll Question")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pinned (1)" }));

    expect(screen.getByText("HR Question 2")).toBeInTheDocument();
    expect(screen.queryByText("HR Question 1")).not.toBeInTheDocument();
    expect(screen.queryByText("HR Question 3")).not.toBeInTheDocument();
  });

  it("resets FAQ pagination when the topic filter changes", async () => {
    vi.mocked(listFaqs).mockResolvedValue(
      Array.from({ length: 9 }, (_, index) => ({
        id: `faq-${index + 1}`,
        hub_id: "hub-1",
        question: `Question ${index + 1}`,
        answer: "Answer [1]",
        topic_label: index < 6 ? "HR" : null,
        topic_labels: index < 6 ? ["HR", "Security"] : ["Security"],
        citations: [],
        source_ids: ["src-1"],
        confidence: 0.8,
        is_pinned: false,
        created_at: `2026-01-0${(index % 9) + 1}T00:00:00Z`,
      }))
    );

    renderWithQueryClient(<FaqsPage hubId="hub-1" sources={[]} canEdit={false} />);

    await waitFor(() => expect(screen.getByText("Question 1")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(screen.getByText("Question 9")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "HR (6)" }));

    await waitFor(() => expect(screen.getByText("Question 1")).toBeInTheDocument());
    expect(screen.queryByText("Question 9")).not.toBeInTheDocument();
  });
});
