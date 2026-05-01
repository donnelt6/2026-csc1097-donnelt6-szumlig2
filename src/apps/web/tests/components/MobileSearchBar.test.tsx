import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileSearchBar } from "../../components/hub-dashboard/MobileSearchBar";

const setSearchQueryMock = vi.fn();
const originalMatchMedia = window.matchMedia;

vi.mock("../../lib/SearchContext", () => ({
  useSearch: () => ({
    searchQuery: "",
    setSearchQuery: setSearchQueryMock,
  }),
}));

describe("MobileSearchBar", () => {
  afterEach(() => {
    vi.clearAllMocks();
    window.matchMedia = originalMatchMedia;
  });

  it("renders the page-level fallback search input at 1024px and below", () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === "(max-width: 1024px)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));

    render(<MobileSearchBar placeholder="Search FAQs..." />);

    expect(screen.getByRole("textbox", { name: "Search FAQs..." })).toBeInTheDocument();
  });

  it("updates the shared search query when the user types", async () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === "(max-width: 1024px)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));

    render(<MobileSearchBar placeholder="Search FAQs..." />);

    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Search FAQs..." }), "deadlines");

    expect(setSearchQueryMock).toHaveBeenCalled();
  });

  it("does not render above the 1024px breakpoint", () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));

    render(<MobileSearchBar placeholder="Search FAQs..." />);

    expect(screen.queryByRole("textbox", { name: "Search FAQs..." })).not.toBeInTheDocument();
  });
});
