import type { ActivityEvent } from './types';

export function describeEvent(event: ActivityEvent, currentUserId?: string): string {
  const { action, subject } = describeEventParts(event, currentUserId);
  return subject ? `${action} ${subject}` : action;
}

export function describeEventParts(event: ActivityEvent, currentUserId?: string): { action: string; subject: string } {
  const name = (event.metadata?.name as string) || (event.metadata?.title as string) || '';
  const msg = (event.metadata?.message as string) || '';
  let action: string;
  let subject = '';
  switch (event.resource_type) {
    case 'hub': action = 'Created hub'; subject = name; break;
    case 'source':
      if (event.action === 'deleted') { action = 'Deleted source'; subject = name; }
      else { action = `Added ${(event.metadata?.type as string) || ''} source`.trim(); subject = name; }
      break;
    case 'member':
      if (event.action === 'invited') {
        const role = (event.metadata?.role as string);
        const email = (event.metadata?.email as string) || 'a member';
        action = 'Invited';
        subject = role ? `${email} (${role})` : email;
      }
      else if (event.action === 'removed') { action = 'Removed a member'; }
      else { action = 'Joined hub'; }
      break;
    case 'reminder':
      if (event.action === 'complete') { action = 'Completed reminder'; subject = msg; }
      else if (event.action === 'cancel') { action = 'Cancelled reminder'; subject = msg; }
      else { action = 'Created reminder'; subject = msg || name; }
      break;
    case 'faq': action = `Generated ${(event.metadata?.count as number) || ''} FAQs`; break;
    case 'guide': action = 'Generated guide'; subject = name; break;
    case 'chat': action = 'Started chat'; subject = name; break;
    default: action = `${event.action} ${event.resource_type}`;
  }
  if (currentUserId && event.user_id === currentUserId) {
    action = 'You ' + action.charAt(0).toLowerCase() + action.slice(1);
  }
  return { action, subject };
}

export function getEventTone(event: ActivityEvent): 'destructive' | 'positive' | 'neutral' {
  const { action, resource_type } = event;
  if (action === 'deleted' || action === 'removed' || action === 'cancel') return 'destructive';
  if (action === 'created' || action === 'joined' || action === 'invited' || action === 'started' || action === 'generated') return 'positive';
  if (resource_type === 'reminder' && action === 'complete') return 'positive';
  return 'neutral';
}

export function getTimeGroup(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  if (date >= today) return 'Today';
  if (date >= yesterday) return 'Yesterday';
  if (date >= weekAgo) return 'This Week';
  return 'Earlier';
}

export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return "Never";

  const now = new Date().getTime();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  const weeks = Math.floor(diffMs / 604800000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return `${weeks}w ago`;
}
