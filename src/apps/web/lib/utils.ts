import type { ActivityEvent } from './types';

export function describeEventParts(event: ActivityEvent, currentUserId?: string): { action: string; subject: string } {
  const actorLabel = resolveActorLabel(event, currentUserId);
  const name = (event.metadata?.name as string) || (event.metadata?.title as string) || '';
  const msg = (event.metadata?.message as string) || '';
  let action: string;
  let subject = '';
  switch (event.resource_type) {
    case 'hub': action = `${actorLabel} created hub`; subject = name; break;
    case 'source':
      if (event.action === 'deleted') { action = `${actorLabel} deleted source`; subject = name; }
      else { action = `${actorLabel} added ${((event.metadata?.type as string) || '').trim()} source`.replace(/\s+/g, ' ').trim(); subject = name; }
      break;
    case 'member':
      if (event.action === 'invited') {
        const role = (event.metadata?.role as string);
        const email = (event.metadata?.email as string) || 'a member';
        action = `${actorLabel} invited`;
        subject = role ? `${email} (${role})` : email;
      }
      else if (event.action === 'removed') { action = `${actorLabel} removed`; subject = 'a member'; }
      else { action = `${actorLabel} joined hub`; }
      break;
    case 'reminder': {
      const rLabel = name || msg;
      if (event.action === 'complete') { action = `${actorLabel} completed reminder`; subject = rLabel; }
      else if (event.action === 'cancel') { action = `${actorLabel} cancelled reminder`; subject = rLabel; }
      else if (event.action === 'updated') { action = `${actorLabel} updated reminder`; subject = rLabel; }
      else if (event.action === 'deleted') { action = `${actorLabel} deleted reminder`; subject = rLabel; }
      else { action = `${actorLabel} created reminder`; subject = rLabel; }
      break;
    }
    case 'faq': action = `${actorLabel} generated ${((event.metadata?.count as number) || '')} FAQs`.replace(/\s+/g, ' ').trim(); break;
    case 'guide': action = `${actorLabel} generated guide`; subject = name; break;
    case 'chat': action = `${actorLabel} started chat`; subject = name; break;
    default: action = `${actorLabel} ${event.action} ${event.resource_type}`.replace(/\s+/g, ' ').trim();
  }
  return { action, subject };
}

function resolveActorLabel(event: ActivityEvent, currentUserId?: string): string {
  if (currentUserId && event.user_id === currentUserId) {
    return 'You';
  }
  const actorLabel = (event.metadata?.actor_label as string | undefined)?.trim();
  return actorLabel || 'Someone';
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
