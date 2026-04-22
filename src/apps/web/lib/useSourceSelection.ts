// useSourceSelection.ts: Exclusion-based source selection hook with localStorage persistence.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Source } from "@shared/index";

const STORAGE_PREFIX = "caddie:hub";

export function useSourceSelection(hubId: string, sources: Source[]) {
  const storageKey = useMemo(() => `${STORAGE_PREFIX}:${hubId}:source-exclusions`, [hubId]);
  const completeSources = useMemo(
    () => sources.filter((source) => source.status === "complete"),
    [sources]
  );
  const completeIds = useMemo(() => completeSources.map((source) => source.id), [completeSources]);
  const completeIdSet = useMemo(() => new Set(completeIds), [completeIds]);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      setExcludedIds(new Set());
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setExcludedIds(new Set());
        return;
      }
      const filtered = parsed.filter(
        (value): value is string => typeof value === "string" && completeIdSet.has(value)
      );
      setExcludedIds(new Set(filtered));
      if (filtered.length !== parsed.length) {
        window.localStorage.setItem(storageKey, JSON.stringify(filtered));
      }
    } catch {
      setExcludedIds(new Set());
    }
  }, [storageKey, completeIdSet]);

  const persistExcluded = useCallback(
    (next: Set<string>) => {
      setExcludedIds(next);
      if (typeof window === "undefined") return;
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
    },
    [storageKey]
  );

  const toggleSource = useCallback(
    (sourceId: string) => {
      if (!completeIdSet.has(sourceId)) return;
      const next = new Set(excludedIds);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      persistExcluded(next);
    },
    [completeIdSet, excludedIds, persistExcluded]
  );

  const selectAll = useCallback((scope?: string[]) => {
    if (!scope) {
      persistExcluded(new Set());
      return;
    }
    const next = new Set(excludedIds);
    for (const id of scope) next.delete(id);
    persistExcluded(next);
  }, [excludedIds, persistExcluded]);

  const clearAll = useCallback((scope?: string[]) => {
    if (!scope) {
      persistExcluded(new Set(completeIds));
      return;
    }
    const next = new Set(excludedIds);
    for (const id of scope) {
      if (completeIdSet.has(id)) next.add(id);
    }
    persistExcluded(next);
  }, [completeIds, completeIdSet, excludedIds, persistExcluded]);

  const setSelectedIds = useCallback((ids: string[]) => {
    const selectedSet = new Set(ids);
    const nextExcluded = new Set<string>();
    for (const id of completeIds) {
      if (!selectedSet.has(id)) nextExcluded.add(id);
    }
    persistExcluded(nextExcluded);
  }, [completeIds, persistExcluded]);

  const selectedIds = useMemo(
    () => completeIds.filter((id) => !excludedIds.has(id)),
    [completeIds, excludedIds]
  );

  return {
    selectedIds,
    setSelectedIds,
    toggleSource,
    selectAll,
    clearAll,
    completeCount: completeIds.length,
  };
}
