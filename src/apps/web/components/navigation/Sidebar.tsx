'use client';

// Sidebar.tsx: Collapsible sidebar navigation with page links and hub creation.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Squares2X2Icon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  UsersIcon,
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useHubTab } from '../../lib/HubTabContext';
import { useCurrentHub } from '../../lib/CurrentHubContext';
import { listChatSessions, deleteChatSession, renameChatSession } from '../../lib/api';
import type { ChatSessionSummary } from '@shared/index';

type SidebarState = 'open' | 'collapsed' | 'hidden';

interface SidebarProps {
  state: SidebarState;
  onStateChange: (state: SidebarState) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onCreateHub?: () => void;
}

function formatSessionTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  if (date >= yesterday && date < today) return "Yesterday";

  return date.toLocaleDateString("en-IE", { day: "2-digit", month: "short" });
}

export function Sidebar({ state, onStateChange, mobileOpen, onMobileClose, onCreateHub }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useParams<{ hubId: string }>();
  const searchParams = useSearchParams();
  const { activeTab, setActiveTab } = useHubTab();
  const { currentHub } = useCurrentHub();

  const hubId = params?.hubId ?? null;
  const isOnHub = pathname.startsWith('/hubs/');
  const showChatSessions = isOnHub && activeTab === 'chat';
  const canModerate = currentHub?.id === hubId && (currentHub.role === 'owner' || currentHub.role === 'admin');

  const { data: sessions = [], refetch } = useQuery({
    queryKey: ['chat-sessions', hubId],
    queryFn: () => listChatSessions(hubId!),
    enabled: !!hubId && showChatSessions,
    staleTime: 0,
  });

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const activeSessionId = searchParams.get('session');

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  function navigateToTab(tab: 'chat' | 'sources' | 'dashboard' | 'members' | 'admin') {
    const p = new URLSearchParams(searchParams.toString());
    p.set('tab', tab);
    setSessionActionError(null);
    setActiveTab(tab);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    handleLinkClick();
  }

  function navigateToSession(sessionId: string) {
    const p = new URLSearchParams(searchParams.toString());
    p.set('session', sessionId);
    p.delete('message');
    setSessionActionError(null);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  function navigateToNewChat() {
    const p = new URLSearchParams(searchParams.toString());
    p.set('session', 'new');
    p.set('tab', 'chat');
    p.delete('message');
    setSessionActionError(null);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  function startRename(session: ChatSessionSummary) {
    setSessionActionError(null);
    setEditingSessionId(session.id);
    setEditTitle(session.title);
  }

  async function saveRename(sessionId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const queryKey = ['chat-sessions', hubId] as const;
    const previousSessions = queryClient.getQueryData<ChatSessionSummary[]>(queryKey) ?? [];
    const nextSessions = previousSessions.map((session) =>
      session.id === sessionId ? { ...session, title: trimmed } : session
    );
    queryClient.setQueryData(queryKey, nextSessions);
    try {
      await renameChatSession(sessionId, trimmed);
      setSessionActionError(null);
    } catch (error) {
      queryClient.setQueryData(queryKey, previousSessions);
      setSessionActionError(error instanceof Error ? error.message : "Couldn't update chat name.");
      await refetch();
    }
  }

  async function commitRename() {
    if (!editingSessionId) return;
    const trimmed = editTitle.trim();
    if (!trimmed) { setEditingSessionId(null); return; }
    const sessionId = editingSessionId;
    setEditingSessionId(null);
    await saveRename(sessionId, trimmed);
  }

  function handleRenameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') { event.preventDefault(); void commitRename(); }
    else if (event.key === 'Escape') { setEditingSessionId(null); setSessionActionError(null); }
  }

  async function handleDelete(sessionId: string) {
    if (!window.confirm("Delete this chat?")) return;
    const queryKey = ['chat-sessions', hubId] as const;
    const previousSessions = queryClient.getQueryData<ChatSessionSummary[]>(queryKey) ?? [];
    queryClient.setQueryData(
      queryKey,
      previousSessions.filter((session) => session.id !== sessionId)
    );
    const deletedWasActive = activeSessionId === sessionId;
    if (deletedWasActive) {
      navigateToNewChat();
    }
    try {
      await deleteChatSession(sessionId);
      try {
        localStorage.removeItem(`caddie:session-sources:${sessionId}`);
        if (localStorage.getItem(`caddie:last-session:${hubId}`) === sessionId) {
          localStorage.removeItem(`caddie:last-session:${hubId}`);
        }
      } catch {}
      setSessionActionError(null);
      queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      queryClient.setQueryData(queryKey, previousSessions);
      if (deletedWasActive) {
        navigateToSession(sessionId);
      }
      setSessionActionError(error instanceof Error ? error.message : "Couldn't delete chat.");
      await refetch();
    }
  }

  const expandSidebar = () => {
    localStorage.setItem('sidebar-state', 'open');
    onStateChange('open');
  };

  const collapseSidebar = () => {
    localStorage.setItem('sidebar-state', 'collapsed');
    onStateChange('collapsed');
  };

  const isCollapsed = state === 'collapsed';

  const sidebarClasses = [
    'sidebar',
    state === 'hidden' ? 'sidebar--hidden' : '',
    isCollapsed ? 'sidebar--collapsed' : '',
    mobileOpen ? 'sidebar--mobile-open' : '',
  ].filter(Boolean).join(' ');

  const handleLinkClick = () => {
    onMobileClose?.();
  };

  return (
    <aside className={sidebarClasses}>
      <div className="sidebar-header">
        <Link href="/" className="sidebar-brand" onClick={handleLinkClick}>
          <span className="sidebar-brand-text">Caddie</span>
        </Link>
        {isCollapsed ? (
          <button
            className="sidebar-toggle"
            onClick={expandSidebar}
            aria-label="Expand sidebar"
          >
            <ChevronRightIcon className="sidebar-toggle-icon" />
          </button>
        ) : (
          <button
            className="sidebar-toggle"
            onClick={collapseSidebar}
            aria-label="Collapse sidebar"
          >
            <ChevronLeftIcon className="sidebar-toggle-icon" />
          </button>
        )}
        {mobileOpen && (
          <button
            className="sidebar-mobile-close"
            onClick={onMobileClose}
            aria-label="Close menu"
          >
            <XMarkIcon className="sidebar-toggle-icon" />
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        {isOnHub && (
          <div className="sidebar-section sidebar-hub-back">
            <button
              className="sidebar-item sidebar-item--back"
              title={isCollapsed ? 'Back to Your Hubs' : undefined}
              onClick={() => {
                router.push('/hubs');
                handleLinkClick();
              }}
              type="button"
            >
              <ArrowLeftIcon className="sidebar-item-icon" />
              <span className="sidebar-item-text">Back to Your Hubs</span>
            </button>
          </div>
        )}

        <ul className="sidebar-nav-list">
          {[
            { key: 'chat' as const, label: 'Chat', Icon: ChatBubbleLeftRightIcon },
            { key: 'sources' as const, label: 'Sources', Icon: DocumentTextIcon },
            { key: 'dashboard' as const, label: 'Dashboard', Icon: Squares2X2Icon },
            { key: 'members' as const, label: 'Members', Icon: UsersIcon },
            ...(canModerate ? [{ key: 'admin' as const, label: 'Admin', Icon: ShieldCheckIcon }] : []),
          ].map(({ key, label, Icon }) => (
            <li key={key}>
              <button
                className={`sidebar-item${activeTab === key ? ' active' : ''}`}
                title={isCollapsed ? label : undefined}
                onClick={() => navigateToTab(key)}
                type="button"
              >
                <Icon className="sidebar-item-icon" />
                <span className="sidebar-item-text">{label}</span>
              </button>
            </li>
          ))}
        </ul>

        {showChatSessions && (
        <div className="sidebar-section sidebar-chat-sessions">
          <button
            className="sidebar-new-chat-button"
            onClick={navigateToNewChat}
            type="button"
          >
            <PlusIcon className="sidebar-new-chat-icon" />
            <span>New Chat</span>
          </button>
          <p className="sidebar-section-title">Recent Chats</p>
          {sessionActionError && (
            <p className="chat__banner-error sidebar-chat-error">Error: {sessionActionError}</p>
          )}
          <ul className="sidebar-nav-list sidebar-chat-list">
            {sessions.map((session: ChatSessionSummary) => (
              <li key={session.id} className="sidebar-chat-item">
                {editingSessionId === session.id ? (
                  <input
                    ref={editInputRef}
                    className="sidebar-chat-edit-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={() => {
                      const id = editingSessionId;
                      const trimmed = editTitle.trim();
                      setEditingSessionId(null);
                      if (id && trimmed) {
                        void saveRename(id, trimmed);
                      }
                    }}
                    maxLength={80}
                  />
                ) : (
                  <>
                    <button
                      className={`sidebar-chat-button${activeSessionId === session.id ? ' active' : ''}`}
                      onClick={() => navigateToSession(session.id)}
                      title={session.title}
                      type="button"
                    >
                      <span className="sidebar-chat-title">{session.title}</span>
                      <span className="sidebar-chat-time">{formatSessionTimestamp(session.last_message_at)}</span>
                    </button>
                    <div className="sidebar-chat-actions">
                      <button
                        className="sidebar-chat-action"
                        onClick={() => startRename(session)}
                        aria-label={`Rename ${session.title}`}
                        title="Rename"
                        type="button"
                      >
                        <PencilIcon className="sidebar-chat-action-icon" />
                      </button>
                      <button
                        className="sidebar-chat-action"
                        onClick={() => void handleDelete(session.id)}
                        aria-label={`Delete ${session.title}`}
                        title="Delete"
                        type="button"
                      >
                        <TrashIcon className="sidebar-chat-action-icon" />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      </nav>

      <div className="sidebar-footer">
        {!isOnHub && (
          <button
            className="sidebar-item sidebar-new-hub-button"
            onClick={() => {
              if (onCreateHub) {
                onCreateHub();
              } else {
                router.push('/hubs?create=true');
              }
              onMobileClose?.();
            }}
            title={isCollapsed ? 'New Hub' : undefined}
          >
            <PlusIcon className="sidebar-item-icon" />
            <span className="sidebar-item-text">New Hub</span>
          </button>
        )}
      </div>
    </aside>
  );
}
