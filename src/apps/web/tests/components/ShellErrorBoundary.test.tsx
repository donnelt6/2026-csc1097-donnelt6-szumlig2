import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShellErrorBoundary } from "../../components/ShellErrorBoundary";

function ExplodingChild() {
  throw new Error("boom");
}

describe("ShellErrorBoundary", () => {
  it("renders a fallback instead of raw crash content", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ShellErrorBoundary>
        <ExplodingChild />
      </ShellErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it("retries after a boundary failure", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let shouldThrow = true;
    function MaybeExplodingChild() {
      if (shouldThrow) {
        throw new Error("boom");
      }
      return <div>Recovered</div>;
    }

    render(
      <ShellErrorBoundary>
        <MaybeExplodingChild />
      </ShellErrorBoundary>,
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("Recovered")).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});
