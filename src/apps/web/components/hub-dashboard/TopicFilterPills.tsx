'use client';

// TopicFilterPills.tsx: Renders AI topic pills as separate segmented rows when they wrap.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TopicFilterOption } from "./topicFilters";

interface Props {
  options: TopicFilterOption[];
  selectedTopic: string | null;
  onSelectTopic: (topic: string | null) => void;
  ariaLabel: string;
}

interface PillDefinition {
  key: string;
  label: string;
  topic: string | null;
}

const GROUP_HORIZONTAL_PADDING = 8;

export function TopicFilterPills({ options, selectedTopic, onSelectTopic, ariaLabel }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const measureRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [availableWidth, setAvailableWidth] = useState(0);
  const [rows, setRows] = useState<PillDefinition[][]>([]);

  const pills = useMemo<PillDefinition[]>(
    () => [
      { key: "all-topics", label: "All Topics", topic: null },
      ...options.map((option) => ({
        key: option.label,
        label: `${option.label} (${option.count})`,
        topic: option.label,
      })),
    ],
    [options]
  );

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const measureTarget = node.parentElement;
    if (!measureTarget) return;
    const updateWidth = () => setAvailableWidth(measureTarget.clientWidth);
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(measureTarget);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!pills.length) {
      setRows([]);
      return;
    }
    if (!availableWidth) {
      setRows([pills]);
      return;
    }

    const measured = pills.map((pill) => ({
      pill,
      width: measureRefs.current[pill.key]?.getBoundingClientRect().width ?? 0,
    }));

    if (measured.some((item) => item.width === 0)) {
      setRows([pills]);
      return;
    }

    const nextRows: PillDefinition[][] = [];
    let currentRow: PillDefinition[] = [];
    let currentWidth = GROUP_HORIZONTAL_PADDING;

    for (const { pill, width } of measured) {
      const pillWidth = Math.ceil(width);
      if (currentRow.length > 0 && currentWidth + pillWidth > availableWidth) {
        nextRows.push(currentRow);
        currentRow = [pill];
        currentWidth = GROUP_HORIZONTAL_PADDING + pillWidth;
      } else {
        currentRow.push(pill);
        currentWidth += pillWidth;
      }
    }

    if (currentRow.length > 0) {
      nextRows.push(currentRow);
    }

    setRows(nextRows);
  }, [availableWidth, pills]);

  const renderedRows = rows.length > 0 ? rows : [pills];

  return (
    <div ref={wrapperRef} className="topic-filter-pills" aria-label={ariaLabel}>
      <div className="topic-filter-pills__measure" aria-hidden="true">
        {pills.map((pill) => (
          <button
            key={pill.key}
            ref={(node) => {
              measureRefs.current[pill.key] = node;
            }}
            type="button"
            className="sources__filter-pill"
            tabIndex={-1}
          >
            {pill.label}
          </button>
        ))}
      </div>
      {renderedRows.map((row, index) => (
        <div key={`topic-row-${index}`} className="sources__filter-pills topic-filter-pills__row">
          {row.map((pill) => {
            const isActive = pill.topic === null ? selectedTopic === null : selectedTopic === pill.topic;
            return (
              <button
                key={pill.key}
                type="button"
                className={`sources__filter-pill${isActive ? " sources__filter-pill--active" : ""}`}
                onClick={() => onSelectTopic(pill.topic === selectedTopic ? null : pill.topic)}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
