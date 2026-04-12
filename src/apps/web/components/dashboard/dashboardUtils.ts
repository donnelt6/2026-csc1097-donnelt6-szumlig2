// dashboardUtils.ts: Icon mappings and helper functions for dashboard components.

import {
  RectangleStackIcon,
  DocumentIcon,
  DocumentMinusIcon,
  UserPlusIcon,
  UserMinusIcon,
  BellIcon,
  BellSlashIcon,
  QuestionMarkCircleIcon,
  BookOpenIcon,
  ChatBubbleLeftIcon,
} from '@heroicons/react/24/outline';
import type { ActivityEvent } from '../../lib/types';

export function getEventIcon(event: ActivityEvent): React.ComponentType<React.SVGProps<SVGSVGElement>> {
  if (event.resource_type === 'source') return event.action === 'deleted' ? DocumentMinusIcon : DocumentIcon;
  if (event.resource_type === 'member') return event.action === 'removed' ? UserMinusIcon : UserPlusIcon;
  if (event.resource_type === 'reminder' && event.action === 'cancel') return BellSlashIcon;
  const map: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
    hub: RectangleStackIcon, reminder: BellIcon, faq: QuestionMarkCircleIcon,
    guide: BookOpenIcon, chat: ChatBubbleLeftIcon,
  };
  return map[event.resource_type] || RectangleStackIcon;
}

export function buildHubNameMap(hubs: { id: string; name: string }[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  hubs?.forEach((h) => map.set(h.id, h.name));
  return map;
}
