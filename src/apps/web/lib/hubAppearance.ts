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
  { key: "slate", label: "Slate", value: "#64748b" },
  { key: "violet", label: "Violet", value: "#8b5cf6" },
  { key: "cyan", label: "Cyan", value: "#06b6d4" },
  { key: "blue", label: "Blue", value: "#3b82f6" },
  { key: "emerald", label: "Emerald", value: "#10b981" },
  { key: "amber", label: "Amber", value: "#f59e0b" },
  { key: "rose", label: "Rose", value: "#f43f5e" },
  { key: "orange", label: "Orange", value: "#f97316" },
  { key: "pink", label: "Pink", value: "#ec4899" },
  { key: "indigo", label: "Indigo", value: "#6366f1" },
  { key: "teal", label: "Teal", value: "#14b8a6" },
  { key: "red", label: "Red", value: "#ef4444" },
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
      backgroundColor: withAlpha(color.value, "1A"),
      color: color.value,
    },
    previewStyle: {
      background: `linear-gradient(135deg, ${withAlpha(color.value, "D9")} 0%, ${color.value} 100%)`,
      color: "#ffffff",
    },
  };
}
