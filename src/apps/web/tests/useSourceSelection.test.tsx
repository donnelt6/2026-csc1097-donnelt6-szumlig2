import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSourceSelection } from "../lib/useSourceSelection";
import type { Source } from "@shared/index";

const buildSource = (overrides: Partial<Source>): Source => ({
  id: "src-1",
  hub_id: "hub-1",
  type: "file",
  original_name: "file.txt",
  status: "complete",
  created_at: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("useSourceSelection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to all complete sources selected", async () => {
    const sources: Source[] = [
      buildSource({ id: "src-1", status: "complete" }),
      buildSource({ id: "src-2", status: "processing" }),
      buildSource({ id: "src-3", status: "complete" }),
    ];

    const { result } = renderHook(() => useSourceSelection("hub-1", sources));

    await waitFor(() => {
      expect(result.current.selectedIds).toEqual(["src-1", "src-3"]);
    });
  });

  it("honors stored exclusions and drops stale ids", async () => {
    window.localStorage.setItem(
      "caddie:hub:hub-1:source-exclusions",
      JSON.stringify(["src-1", "stale-id"])
    );
    const sources: Source[] = [
      buildSource({ id: "src-1", status: "complete" }),
      buildSource({ id: "src-2", status: "complete" }),
    ];

    const { result } = renderHook(() => useSourceSelection("hub-1", sources));

    await waitFor(() => {
      expect(result.current.selectedIds).toEqual(["src-2"]);
    });

    const stored = JSON.parse(
      window.localStorage.getItem("caddie:hub:hub-1:source-exclusions") ?? "[]"
    );
    expect(stored).toEqual(["src-1"]);
  });
});
