// hubAppearance.ts: Hub icon and colour palettes used by the appearance picker.

import type { ComponentType, SVGProps } from "react";
import {
  AcademicCapIcon,
  BeakerIcon,
  BoltIcon,
  BookOpenIcon,
  BriefcaseIcon,
  ChatBubbleLeftRightIcon,
  FolderIcon,
  GlobeAltIcon,
  RectangleStackIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";

export type HubIconKey =
  | "stack"
  | "book"
  | "chat"
  | "cap"
  | "briefcase"
  | "beaker"
  | "folder"
  | "rocket"
  | "globe"
  | "bolt"
  | "sparkles"
  | "shield";

export type HubColorKey =
  | "slate"
  | "violet"
  | "cyan"
  | "blue"
  | "emerald"
  | "amber"
  | "rose"
  | "orange"
  | "pink"
  | "indigo"
  | "teal"
  | "red";

export type HubIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface HubIconOption {
  key: HubIconKey;
  label: string;
  icon: HubIconComponent;
}

export interface HubColorOption {
  key: HubColorKey;
  label: string;
  value: string;
}

export const DEFAULT_HUB_ICON_KEY: HubIconKey = "stack";
export const DEFAULT_HUB_COLOR_KEY: HubColorKey = "slate";

export const HUB_ICON_OPTIONS: HubIconOption[] = [
  { key: "stack", label: "Stack", icon: RectangleStackIcon },
  { key: "book", label: "Book", icon: BookOpenIcon },
  { key: "chat", label: "Chat", icon: ChatBubbleLeftRightIcon },
  { key: "cap", label: "Learn", icon: AcademicCapIcon },
  { key: "briefcase", label: "Work", icon: BriefcaseIcon },
  { key: "beaker", label: "Lab", icon: BeakerIcon },
  { key: "folder", label: "Folder", icon: FolderIcon },
  { key: "rocket", label: "Launch", icon: RocketLaunchIcon },
  { key: "globe", label: "Global", icon: GlobeAltIcon },
  { key: "bolt", label: "Fast", icon: BoltIcon },
  { key: "sparkles", label: "Ideas", icon: SparklesIcon },
  { key: "shield", label: "Secure", icon: ShieldCheckIcon },
];

export const HUB_COLOR_OPTIONS: HubColorOption[] = [
  { key: "slate", label: "Slate", value: "#6f8096" },
  { key: "violet", label: "Violet", value: "#9277db" },
  { key: "cyan", label: "Cyan", value: "#46b1ca" },
  { key: "blue", label: "Blue", value: "#4d8fe2" },
  { key: "emerald", label: "Emerald", value: "#4ca988" },
  { key: "amber", label: "Amber", value: "#d4a24a" },
  { key: "rose", label: "Rose", value: "#d8708b" },
  { key: "orange", label: "Orange", value: "#dc8553" },
  { key: "pink", label: "Pink", value: "#d575ab" },
  { key: "indigo", label: "Indigo", value: "#6f7fda" },
  { key: "teal", label: "Teal", value: "#43a7a0" },
  { key: "red", label: "Red", value: "#d56f6f" },
];

function withAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}

export function getHubIconOption(iconKey?: string | null): HubIconOption {
  return HUB_ICON_OPTIONS.find((option) => option.key === iconKey) ?? HUB_ICON_OPTIONS[0];
}

export function getHubColorOption(colorKey?: string | null): HubColorOption {
  return HUB_COLOR_OPTIONS.find((option) => option.key === colorKey) ?? HUB_COLOR_OPTIONS[0];
}

export function resolveHubAppearance(iconKey?: string | null, colorKey?: string | null) {
  const icon = getHubIconOption(iconKey);
  const color = getHubColorOption(colorKey);

  return {
    icon,
    color,
    badgeStyle: {
      background: `linear-gradient(135deg, ${withAlpha(color.value, "F0")} 0%, ${color.value} 100%)`,
      color: "#ffffff",
    },
    previewStyle: {
      background: `linear-gradient(135deg, ${withAlpha(color.value, "D9")} 0%, ${color.value} 100%)`,
      color: "#ffffff",
    },
  };
}
