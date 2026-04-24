// topicFilters.ts: Shared topic-pill counting and filtering helpers for dashboard content pages.

export interface TopicLabeledEntry {
  topic_label?: string | null;
}

export interface TopicFilterOption {
  label: string;
  count: number;
}

const TOPIC_FILTER_MIN_COUNT = 3;

export function normalizeTopicLabel(label?: string | null): string | null {
  const trimmed = label?.trim();
  return trimmed ? trimmed : null;
}

export function buildTopicFilterOptions<T extends TopicLabeledEntry>(entries: T[]): TopicFilterOption[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const label = normalizeTopicLabel(entry.topic_label);
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= TOPIC_FILTER_MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
}

export function matchesTopicFilter(topicLabel: string | null, selectedTopic: string | null): boolean {
  if (!selectedTopic) return true;
  return normalizeTopicLabel(topicLabel) === selectedTopic;
}
