// topicFilters.ts: Shared topic-pill counting and filtering helpers for dashboard content pages.

export interface TopicLabeledEntry {
  topic_label?: string | null;
  topic_labels?: string[];
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
    const labels = getEntryTopicLabels(entry);
    for (const label of labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= TOPIC_FILTER_MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
}

export function matchesTopicFilter(entry: TopicLabeledEntry, selectedTopic: string | null): boolean {
  if (!selectedTopic) return true;
  return getEntryTopicLabels(entry).includes(selectedTopic);
}

export function getEntryTopicLabels(entry: TopicLabeledEntry): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const candidate of entry.topic_labels ?? []) {
    const normalized = normalizeTopicLabel(candidate);
    if (!normalized || seen.has(normalized)) continue;
    labels.push(normalized);
    seen.add(normalized);
  }
  const fallback = normalizeTopicLabel(entry.topic_label);
  if (fallback && !seen.has(fallback)) {
    labels.push(fallback);
  }
  return labels;
}
