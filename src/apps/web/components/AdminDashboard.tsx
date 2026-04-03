'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  FlagIcon,
  FolderIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  decideSourceSuggestion,
  dismissContentFlag,
  dismissFlaggedChat,
  listFlaggedChats,
  listFlaggedContent,
  listSourceSuggestions,
  listSources,
  regenerateFlaggedChat,
  resolveContentFlag,
  createFlaggedChatRevision,
  applyFlaggedChatRevision,
} from '../lib/api';
import { HubAnalyticsPanel } from './HubAnalyticsPanel';
import { useHubDashboardTab } from '../lib/HubDashboardTabContext';
import type {
  Citation,
  FlaggedContentQueueItem,
  FlaggedChatQueueItem,
  MembershipRole,
  SourceSuggestion,
} from '../lib/types';
import type { HubTab } from '../lib/HubTabContext';

type ModTab = 'chats' | 'faqs' | 'guides';

interface AdminDashboardProps {
  hubId: string;
  hubRole?: MembershipRole | null;
  onSwitchTab?: (tab: HubTab) => void;
}

export function AdminDashboard({ hubId, hubRole, onSwitchTab }: AdminDashboardProps) {
  const queryClient = useQueryClient();
  const { activeAdminTab } = useHubDashboardTab();
  const canModerate = hubRole === 'owner' || hubRole === 'admin';

  const [modTab, setModTab] = useState<ModTab>('chats');
  const [showResolved, setShowResolved] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editFlagId, setEditFlagId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [draftCitations, setDraftCitations] = useState('[]');

  const { data: sources = [] } = useQuery({
    queryKey: ['sources', hubId],
    queryFn: () => listSources(hubId),
    enabled: canModerate,
    staleTime: 0,
  });

  const { data: suggestions = [] } = useQuery({
    queryKey: ['source-suggestions', hubId],
    queryFn: () => listSourceSuggestions({ hubId, status: 'pending' }),
    enabled: canModerate,
    staleTime: 0,
    refetchInterval: 10000,
  });

  const { data: openFlags = [] } = useQuery({
    queryKey: ['flagged-chats', hubId, 'open'],
    queryFn: () => listFlaggedChats(hubId, { status: 'open' }),
    enabled: canModerate,
    refetchInterval: 5000,
  });

  const { data: inReviewFlags = [] } = useQuery({
    queryKey: ['flagged-chats', hubId, 'in_review'],
    queryFn: () => listFlaggedChats(hubId, { status: 'in_review' }),
    enabled: canModerate,
    refetchInterval: 5000,
  });

  const { data: resolvedFlags = [] } = useQuery({
    queryKey: ['flagged-chats', hubId, 'resolved'],
    queryFn: () => listFlaggedChats(hubId, { status: 'resolved' }),
    enabled: canModerate,
    staleTime: 0,
  });

  const { data: dismissedFlags = [] } = useQuery({
    queryKey: ['flagged-chats', hubId, 'dismissed'],
    queryFn: () => listFlaggedChats(hubId, { status: 'dismissed' }),
    enabled: canModerate,
    staleTime: 0,
  });

  const { data: openContentFlags = [] } = useQuery({
    queryKey: ['flagged-content', hubId, 'open'],
    queryFn: () => listFlaggedContent(hubId, { status: 'open' }),
    enabled: canModerate,
    refetchInterval: 10000,
  });

  const { data: resolvedContentFlags = [] } = useQuery({
    queryKey: ['flagged-content', hubId, 'resolved'],
    queryFn: () => listFlaggedContent(hubId, { status: 'resolved' }),
    enabled: canModerate,
    staleTime: 0,
  });

  const { data: dismissedContentFlags = [] } = useQuery({
    queryKey: ['flagged-content', hubId, 'dismissed'],
    queryFn: () => listFlaggedContent(hubId, { status: 'dismissed' }),
    enabled: canModerate,
    staleTime: 0,
  });

  const pendingChats = useMemo(
    () => [...openFlags, ...inReviewFlags],
    [openFlags, inReviewFlags],
  );

  const pendingFaqs = useMemo(
    () => openContentFlags.filter((f) => f.content_type === 'faq'),
    [openContentFlags],
  );

  const pendingGuides = useMemo(
    () => openContentFlags.filter((f) => f.content_type === 'guide'),
    [openContentFlags],
  );

  const resolvedCount = resolvedFlags.length + dismissedFlags.length + resolvedContentFlags.length + dismissedContentFlags.length;
  const allResolved = useMemo(
    () => [...resolvedFlags, ...dismissedFlags].sort(
      (a, b) => new Date(b.flagged_at).getTime() - new Date(a.flagged_at).getTime(),
    ),
    [resolvedFlags, dismissedFlags],
  );

  const decideSuggestionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accepted' | 'declined' }) =>
      decideSourceSuggestion(id, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['source-suggestions', hubId] });
      queryClient.invalidateQueries({ queryKey: ['sources', hubId] });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (flagId: string) => regenerateFlaggedChat(hubId, flagId),
    onSuccess: async (_revision, flagId) => {
      await refreshFlag(flagId);
    },
  });

  const manualRevisionMutation = useMutation({
    mutationFn: async (flagId: string) => {
      const trimmed = draftContent.trim();
      if (!trimmed) throw new Error('Content cannot be blank.');
      let citations: Citation[] = [];
      try {
        citations = JSON.parse(draftCitations) as Citation[];
      } catch {
        throw new Error('Citations must be valid JSON.');
      }
      return createFlaggedChatRevision(hubId, flagId, { content: trimmed, citations });
    },
    onSuccess: async (revision, flagId) => {
      setEditModalOpen(false);
      setEditFlagId(null);
      await refreshFlag(flagId);
      applyMutation.mutate({ flagId, revisionId: revision.id });
    },
  });

  const applyMutation = useMutation({
    mutationFn: ({ flagId, revisionId }: { flagId: string; revisionId: string }) =>
      applyFlaggedChatRevision(hubId, flagId, revisionId),
    onSuccess: async (_fc, vars) => {
      await refreshFlag(vars.flagId);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (flagId: string) => dismissFlaggedChat(hubId, flagId),
    onSuccess: async (_fc, flagId) => {
      await refreshFlag(flagId);
    },
  });

  const resolveContentMutation = useMutation({
    mutationFn: (flagId: string) => resolveContentFlag(hubId, flagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flagged-content', hubId] });
    },
  });

  const dismissContentMutation = useMutation({
    mutationFn: (flagId: string) => dismissContentFlag(hubId, flagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flagged-content', hubId] });
    },
  });

  const refreshFlag = async (flagId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['flagged-chats', hubId] }),
      queryClient.invalidateQueries({ queryKey: ['flagged-chat', hubId, flagId] }),
    ]);
  };

  const openEditModal = (flagId: string, item: FlaggedChatQueueItem) => {
    setEditFlagId(flagId);
    setDraftContent(item.answer_preview);
    setDraftCitations('[]');
    setEditModalOpen(true);
  };

  if (!canModerate) {
    return (
      <div className="admin">
        <div className="admin__section">
          <div className="admin__section-body">
            <p className="admin__section-empty">
              Only hub owners and admins can access the admin dashboard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const modTabs: { key: ModTab; label: string; count: number }[] = [
    { key: 'chats', label: 'Chats', count: pendingChats.length },
    { key: 'faqs', label: 'FAQs', count: pendingFaqs.length },
    { key: 'guides', label: 'Guides', count: pendingGuides.length },
  ];

  return (
    <div className="admin">
      {activeAdminTab === 'analytics' ? (
        <HubAnalyticsPanel hubId={hubId} hubRole={hubRole} />
      ) : (
      <>
      <h2 className="admin__title">Admin Console</h2>
      <p className="admin__description">Manage sources, moderate content, and review flagged items.</p>

      <div className="admin__stats">
        <div
          className="admin__stat-card admin__stat-card--clickable"
          onClick={() => onSwitchTab?.('sources')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onSwitchTab?.('sources'); }}
        >
          <div className="admin__stat-header">
            <div className="admin__stat-icon admin__stat-icon--sources">
              <FolderIcon />
            </div>
            <span className="admin__stat-label">Sources by Status</span>
          </div>
          <span className="admin__stat-value">{sources.length}</span>
          <span className="admin__stat-sub">
            {sources.filter((s) => s.status === 'complete').length} complete
            {' · '}
            {sources.filter((s) => s.status === 'processing' || s.status === 'queued').length} processing
          </span>
        </div>

        <div className="admin__stat-card">
          <div className="admin__stat-header">
            <div className="admin__stat-icon admin__stat-icon--docs">
              <FlagIcon />
            </div>
            <span className="admin__stat-label">Pending Flags</span>
          </div>
          <span className="admin__stat-value">{pendingChats.length + pendingFaqs.length + pendingGuides.length}</span>
          <span className="admin__stat-sub">
            {pendingChats.length} chats · {pendingFaqs.length} FAQs · {pendingGuides.length} guides
          </span>
        </div>

        <div
          className="admin__stat-card admin__stat-card--clickable"
          onClick={() => setShowResolved(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') setShowResolved(true); }}
        >
          <div className="admin__stat-header">
            <div className="admin__stat-icon admin__stat-icon--resolved">
              <ShieldCheckIcon />
            </div>
            <span className="admin__stat-label">Resolved Reviews</span>
          </div>
          <span className="admin__stat-value">{resolvedCount}</span>
          <span className="admin__stat-sub">View all past reviews</span>
        </div>
      </div>

      <div className="admin__main">
        <div className="admin__section">
          <div className="admin__section-header">
            <h3 className="admin__section-title">Suggested Sources</h3>
            {suggestions.length > 0 && (
              <span className="admin__section-badge">{suggestions.length}</span>
            )}
          </div>
          <div className="admin__section-body">
            {suggestions.length === 0 ? (
              <p className="admin__section-empty">No pending source suggestions.</p>
            ) : (
              suggestions.map((s) => (
                <SuggestionRow
                  key={s.id}
                  suggestion={s}
                  onAccept={() => decideSuggestionMutation.mutate({ id: s.id, action: 'accepted' })}
                  onDecline={() => decideSuggestionMutation.mutate({ id: s.id, action: 'declined' })}
                  disabled={decideSuggestionMutation.isPending}
                />
              ))
            )}
          </div>
        </div>

        <div className="admin__section">
          <div className="admin__mod-tabs">
            {modTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`admin__mod-tab${modTab === tab.key ? ' admin__mod-tab--active' : ''}`}
                onClick={() => setModTab(tab.key)}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="admin__mod-tab-badge">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          <div className="admin__mod-list">
            {modTab === 'chats' && (
              pendingChats.length === 0 ? (
                <p className="admin__section-empty">No flagged chats to review.</p>
              ) : (
                pendingChats.map((item) => (
                  <ChatFlagRow
                    key={item.id}
                    item={item}
                    onRegenerate={() => regenerateMutation.mutate(item.id)}
                    onEdit={() => openEditModal(item.id, item)}
                    onDismiss={() => dismissMutation.mutate(item.id)}
                    regenerating={regenerateMutation.isPending}
                    dismissing={dismissMutation.isPending}
                  />
                ))
              )
            )}

            {modTab === 'faqs' && (
              pendingFaqs.length === 0 ? (
                <p className="admin__section-empty">No flagged FAQs to review.</p>
              ) : (
                pendingFaqs.map((item) => (
                  <ContentFlagRow
                    key={item.id}
                    item={item}
                    onResolve={() => resolveContentMutation.mutate(item.id)}
                    onDismiss={() => dismissContentMutation.mutate(item.id)}
                    disabled={resolveContentMutation.isPending || dismissContentMutation.isPending}
                  />
                ))
              )
            )}

            {modTab === 'guides' && (
              pendingGuides.length === 0 ? (
                <p className="admin__section-empty">No flagged guides to review.</p>
              ) : (
                pendingGuides.map((item) => (
                  <ContentFlagRow
                    key={item.id}
                    item={item}
                    onResolve={() => resolveContentMutation.mutate(item.id)}
                    onDismiss={() => dismissContentMutation.mutate(item.id)}
                    disabled={resolveContentMutation.isPending || dismissContentMutation.isPending}
                  />
                ))
              )
            )}
          </div>
        </div>
      </div>

      {showResolved && (
        <div className="modal-backdrop" onClick={() => setShowResolved(false)}>
          <div className="gmodal" onClick={(e) => e.stopPropagation()}>
            <div className="gmodal__header">
              <span className="gmodal__badge">REVIEWS</span>
              <button className="gmodal__icon-btn" type="button" title="Close" onClick={() => setShowResolved(false)}>
                <XMarkIcon />
              </button>
            </div>
            <h3 className="gmodal__title" style={{ margin: '8px 0 16px' }}>Resolved Reviews</h3>
            {allResolved.length === 0 ? (
              <p className="admin__section-empty">No resolved reviews yet.</p>
            ) : (
              <div className="admin__resolved-list">
                {allResolved.map((item) => (
                  <div key={item.id} className="admin__resolved-item">
                    <div className={`admin__resolved-icon admin__resolved-icon--${item.status}`}>
                      {item.status === 'resolved' ? <CheckIcon /> : <XMarkIcon />}
                    </div>
                    <div className="admin__resolved-info">
                      <p className="admin__resolved-title">{item.session_title}</p>
                      <p className="admin__resolved-meta">
                        {item.status === 'resolved' ? 'Resolved' : 'Dismissed'} · {new Date(item.flagged_at).toLocaleDateString('en-IE')}
                      </p>
                      <p className="admin__resolved-answer">Q: {item.question_preview}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {editModalOpen && editFlagId && (
        <div className="modal-backdrop" onClick={() => { setEditModalOpen(false); setEditFlagId(null); }}>
          <div className="gmodal" onClick={(e) => e.stopPropagation()}>
            <div className="gmodal__header">
              <span className="gmodal__badge">EDIT</span>
              <button className="gmodal__icon-btn" type="button" title="Close" onClick={() => { setEditModalOpen(false); setEditFlagId(null); }}>
                <XMarkIcon />
              </button>
            </div>
            <h3 className="gmodal__title" style={{ margin: '8px 0 16px' }}>Edit Response</h3>
            <div className="admin__edit-modal">
              <div>
                <p className="admin__edit-label">Response content</p>
                <textarea className="admin__edit-textarea" value={draftContent} onChange={(e) => setDraftContent(e.target.value)} rows={8} />
              </div>
              <div>
                <p className="admin__edit-label">Citations (JSON)</p>
                <textarea className="admin__edit-textarea" value={draftCitations} onChange={(e) => setDraftCitations(e.target.value)} rows={4} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} />
              </div>
              <div className="admin__edit-actions">
                <button className="admin__mod-btn" type="button" onClick={() => { setEditModalOpen(false); setEditFlagId(null); }}>Cancel</button>
                <button className="admin__mod-btn admin__mod-btn--primary" type="button" onClick={() => manualRevisionMutation.mutate(editFlagId)} disabled={manualRevisionMutation.isPending || !draftContent.trim()}>
                  {manualRevisionMutation.isPending ? 'Saving...' : 'Save & Apply'}
                </button>
              </div>
              {manualRevisionMutation.error && (
                <p style={{ color: 'var(--status-failed)', fontSize: '0.75rem', margin: 0 }}>{(manualRevisionMutation.error as Error).message}</p>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

function SuggestionRow({ suggestion, onAccept, onDecline, disabled }: {
  suggestion: SourceSuggestion; onAccept: () => void; onDecline: () => void; disabled: boolean;
}) {
  const displayUrl = suggestion.canonical_url || suggestion.url;
  const shortUrl = displayUrl.replace(/^https?:\/\//, '').slice(0, 50);
  return (
    <div className="admin__suggestion">
      <div className={`admin__suggestion-icon admin__suggestion-icon--${suggestion.type}`}>
        {suggestion.type === 'youtube' ? 'YT' : 'WEB'}
      </div>
      <div className="admin__suggestion-info">
        <p className="admin__suggestion-title">{suggestion.title || shortUrl}</p>
        <p className="admin__suggestion-url">{shortUrl}</p>
        {suggestion.rationale && <p className="admin__suggestion-rationale">{suggestion.rationale}</p>}
      </div>
      <div className="admin__suggestion-actions">
        <button className="admin__suggestion-btn admin__suggestion-btn--accept" type="button" title="Accept" onClick={onAccept} disabled={disabled}><CheckIcon /></button>
        <button className="admin__suggestion-btn admin__suggestion-btn--decline" type="button" title="Decline" onClick={onDecline} disabled={disabled}><XMarkIcon /></button>
      </div>
    </div>
  );
}

function ChatFlagRow({ item, onRegenerate, onEdit, onDismiss, regenerating, dismissing }: {
  item: FlaggedChatQueueItem; onRegenerate: () => void; onEdit: () => void; onDismiss: () => void; regenerating: boolean; dismissing: boolean;
}) {
  const isActive = ['open', 'in_review'].includes(item.status);
  return (
    <div className="admin__mod-row">
      <div className="admin__mod-row-top">
        <span className={`admin__mod-status admin__mod-status--${item.status}`}>
          <span className="admin__mod-status-dot" />
          {item.status === 'in_review' ? 'In review' : item.status}
        </span>
        <span className="admin__mod-session">{item.session_title}</span>
        <span className="admin__mod-time">{new Date(item.flagged_at).toLocaleDateString('en-IE')}</span>
      </div>
      <div className="admin__mod-row-body">
        <div className="admin__mod-row-content">
          <p className="admin__mod-row-q"><strong>Q:</strong> {item.question_preview}</p>
          <p className="admin__mod-row-a"><strong>A:</strong> {item.answer_preview}</p>
        </div>
        <div className="admin__mod-row-actions">
          <button className="admin__mod-btn admin__mod-btn--primary" type="button" onClick={onRegenerate} disabled={regenerating || !isActive}>
            {regenerating ? 'Regenerating...' : 'Regenerate'}
          </button>
          <button className="admin__mod-btn" type="button" onClick={onEdit} disabled={!isActive}>Edit</button>
          <button className="admin__mod-btn admin__mod-btn--danger" type="button" onClick={onDismiss} disabled={dismissing || !isActive}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

function ContentFlagRow({ item, onResolve, onDismiss, disabled }: {
  item: FlaggedContentQueueItem; onResolve: () => void; onDismiss: () => void; disabled: boolean;
}) {
  return (
    <div className="admin__mod-row">
      <div className="admin__mod-row-top">
        <span className="admin__mod-status admin__mod-status--open">
          <span className="admin__mod-status-dot" />
          {item.reason}
        </span>
        <span className="admin__mod-session">{item.title}</span>
        <span className="admin__mod-time">{new Date(item.flagged_at).toLocaleDateString('en-IE')}</span>
      </div>
      <div className="admin__mod-row-body">
        <div className="admin__mod-row-content">
          {item.preview && <p className="admin__mod-row-a">{item.preview}</p>}
        </div>
        <div className="admin__mod-row-actions">
          <button className="admin__mod-btn admin__mod-btn--primary" type="button" onClick={onResolve} disabled={disabled}>Resolve</button>
          <button className="admin__mod-btn admin__mod-btn--danger" type="button" onClick={onDismiss} disabled={disabled}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
