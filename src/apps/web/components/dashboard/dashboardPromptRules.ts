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
): DashboardPromptSuggestion[] {
  if (!hubs?.length) {
    return [];
  }

  const recentHubs = hubs.slice(0, 3);
  const reminderList = reminders ?? [];
  const candidates: CandidatePrompt[] = [];

  recentHubs.forEach((hub, index) => {
    const sourceCount = hub.sources_count ?? 0;
    if (sourceCount <= 0) {
      return;
    }

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
  const selected: CandidatePrompt[] = [];
  const perHubCount = new Map<string, number>();
  const usedTypes = new Set<PromptType>();

  const trySelect = (enforceUniqueType: boolean) => {
    rankedCandidates.forEach((candidate) => {
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
      if (currentHubCount >= 2) {
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
