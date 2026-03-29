import type { Hub, Reminder } from "../../lib/types";

export interface DashboardPromptSuggestion {
  id: string;
  text: string;
  hubId: string;
}

type HubIntent = "academic" | "project" | "general";
type PromptType = "actions" | "risks" | "study-guide" | "compare";

interface CandidatePrompt extends DashboardPromptSuggestion {
  priority: number;
  type: PromptType;
}

const ACADEMIC_KEYWORDS = [
  "course",
  "class",
  "module",
  "lecture",
  "assignment",
  "exam",
  "study",
  "revision",
  "lab",
  "notes",
  "research",
  "dissertation",
  "thesis",
];

const PROJECT_KEYWORDS = [
  "project",
  "sprint",
  "launch",
  "roadmap",
  "meeting",
  "client",
  "product",
  "team",
  "plan",
  "spec",
  "proposal",
  "delivery",
];

function inferHubIntent(hub: Hub): HubIntent {
  const haystack = `${hub.name} ${hub.description ?? ""}`.toLowerCase();

  if (ACADEMIC_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return "academic";
  }
  if (PROJECT_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return "project";
  }
  return "general";
}

function getHubReminderCount(reminders: Reminder[], hubId: string): number {
  return reminders.filter((reminder) => reminder.hub_id === hubId && reminder.status !== "cancelled").length;
}

export function selectDashboardPrompts(
  hubs: Hub[] | undefined,
  reminders: Reminder[] | undefined,
  limit = 2,
  variant = 0,
): DashboardPromptSuggestion[] {
  if (!hubs?.length) {
    return [];
  }

  const candidateHubs = hubs;
  const reminderList = reminders ?? [];
  const candidates: CandidatePrompt[] = [];
  let eligibleHubCount = 0;

  candidateHubs.forEach((hub, index) => {
    const sourceCount = hub.sources_count ?? 0;
    if (sourceCount <= 0) {
      return;
    }
    eligibleHubCount += 1;

    const recencyBonus = Math.max(0, 8 - index * 3);
    const reminderCount = getHubReminderCount(reminderList, hub.id);
    const intent = inferHubIntent(hub);

    candidates.push({
      id: `${hub.id}-actions`,
      text: "Extract the main action items, deadlines, and responsibilities from this hub. Present them as a clear checklist.",
      hubId: hub.id,
      priority: 92 + recencyBonus + (reminderCount > 0 || intent === "project" ? 8 : 0),
      type: "actions",
    });

    candidates.push({
      id: `${hub.id}-risks`,
      text: "Identify the main risks, blockers, unanswered questions, or unresolved issues in this hub.",
      hubId: hub.id,
      priority: 84 + recencyBonus + (intent === "project" ? 4 : 0),
      type: "risks",
    });

    if (intent === "academic") {
      candidates.push({
        id: `${hub.id}-study-guide`,
        text: "Turn the contents of this hub into a concise study guide with key concepts, definitions, and likely review points.",
        hubId: hub.id,
        priority: 89 + recencyBonus,
        type: "study-guide",
      });
    }

    if (sourceCount > 1) {
      candidates.push({
        id: `${hub.id}-compare`,
        text: "Compare the sources in this hub and highlight any contradictions, overlaps, or important differences.",
        hubId: hub.id,
        priority: 87 + recencyBonus + (sourceCount > 3 ? 3 : 0),
        type: "compare",
      });
    }
  });

  const rankedCandidates = candidates.sort((a, b) => b.priority - a.priority);
  const rotation = rankedCandidates.length > 0 ? Math.abs(variant) % rankedCandidates.length : 0;
  const orderedCandidates = rotation === 0
    ? rankedCandidates
    : [...rankedCandidates.slice(rotation), ...rankedCandidates.slice(0, rotation)];
  const selected: CandidatePrompt[] = [];
  const perHubCount = new Map<string, number>();
  const usedTypes = new Set<PromptType>();
  const maxPerHub = eligibleHubCount >= limit ? 1 : 2;

  const trySelect = (enforceUniqueType: boolean) => {
    orderedCandidates.forEach((candidate) => {
      if (selected.length >= limit) {
        return;
      }
      if (selected.some((item) => item.id === candidate.id)) {
        return;
      }
      if (enforceUniqueType && usedTypes.has(candidate.type)) {
        return;
      }
      const currentHubCount = perHubCount.get(candidate.hubId) ?? 0;
      if (currentHubCount >= maxPerHub) {
        return;
      }
      selected.push(candidate);
      perHubCount.set(candidate.hubId, currentHubCount + 1);
      usedTypes.add(candidate.type);
    });
  };

  trySelect(true);

  if (selected.length < limit) {
    trySelect(false);
  }

  return selected.map(({ id, text, hubId }) => ({ id, text, hubId }));
}
