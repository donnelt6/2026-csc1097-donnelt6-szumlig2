'use client';

// AdminDashboard.tsx: Admin-only overview dashboard with platform-wide statistics.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowPathIcon,
  CheckIcon,
  FlagIcon,
  FolderIcon,
  LightBulbIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  createGuideStep,
  decideSourceSuggestion,
  dismissContentFlag,
  dismissFlaggedChat,
  getFlaggedChat,
  listFaqs,
  listFlaggedChats,
  listFlaggedContent,
  listGuides,
  listSourceSuggestions,
  listSources,
  regenerateFlaggedChat,
  resolveContentFlag,
  updateFaq,
  updateGuide,
  updateGuideStep,
  createFlaggedChatRevision,
  applyFlaggedChatRevision,
} from '../lib/api';
import { HubAnalyticsPanel } from './HubAnalyticsPanel';
import { useHubDashboardTab } from '../lib/HubDashboardTabContext';
import type {
  Citation,
  FaqEntry,
  FlaggedContentQueueItem,
  FlaggedChatQueueItem,
  GuideEntry,
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

function AdminStatCardSkeleton({ index }: { index: number }) {
  return (
    <div className="admin__stat-card admin__stat-card--skeleton" aria-hidden="true" data-testid={`admin-stat-skeleton-${index}`}>
      <div className="admin__stat-header">
        <span className="admin__stat-icon admin__stat-icon--skeleton dash-skeleton" />
        <span className="admin__stat-label-skeleton dash-skeleton" />
      </div>
      <span className="admin__stat-value-skeleton dash-skeleton" />
      <span className="admin__stat-sub-skeleton dash-skeleton" />
    </div>
  );
}

function AdminSuggestionRowSkeleton({ index }: { index: number }) {
  return (
    <div className="admin__sug-row admin__sug-row--skeleton" aria-hidden="true" data-testid={`admin-suggestion-skeleton-${index}`}>
      <span className="admin__sug-row-icon admin__sug-row-icon--skeleton dash-skeleton" />
      <div className="admin__sug-row-content">
        <div className="admin__sug-row-header">
          <span className="admin__sug-row-title-skeleton dash-skeleton" />
          <span className="admin__sug-row-badge-skeleton dash-skeleton" />
        </div>
        <span className="admin__sug-row-url-skeleton dash-skeleton" />
        <span className="admin__sug-row-reason-skeleton dash-skeleton" />
      </div>
      <div className="admin__sug-row-actions" aria-hidden="true">
        <span className="admin__sug-row-btn admin__sug-row-btn--skeleton dash-skeleton" />
        <span className="admin__sug-row-btn admin__sug-row-btn--skeleton dash-skeleton" />
      </div>
    </div>
  );
}

function AdminModerationRowSkeleton({ index }: { index: number }) {
  return (
    <div className="admin__flag-card admin__flag-card--skeleton" aria-hidden="true" data-testid={`admin-moderation-skeleton-${index}`}>
      <div className="admin__flag-card-top">
        <span className="admin__flag-badge-skeleton dash-skeleton" />
        <span className="admin__flag-time-skeleton dash-skeleton" />
      </div>
      <div className="admin__flag-section">
        <span className="admin__flag-label-skeleton dash-skeleton" />
        <span className="admin__flag-text-skeleton dash-skeleton" />
        <span className="admin__flag-text-skeleton admin__flag-text-skeleton--short dash-skeleton" />
      </div>
      <div className="admin__flag-section">
        <span className="admin__flag-label-skeleton dash-skeleton" />
        <span className="admin__flag-text-skeleton dash-skeleton" />
      </div>
      <div className="admin__flag-actions" aria-hidden="true">
        <span className="admin__flag-btn admin__flag-btn--skeleton dash-skeleton" />
        <span className="admin__flag-btn admin__flag-btn--skeleton dash-skeleton" />
        <span className="admin__flag-btn admin__flag-btn--skeleton dash-skeleton" />
      </div>
    </div>
  );
}

export function AdminDashboard({ hubId, hubRole, onSwitchTab }: AdminDashboardProps) {
  const queryClient = useQueryClient();
  const { activeAdminTab } = useHubDashboardTab();
  const canModerate = hubRole === 'owner' || hubRole === 'admin';

  const [modTab, setModTab] = useState<ModTab>('chats');
  const [sugTab, setSugTab] = useState<'pending' | 'reviewed'>('pending');
  const [showResolved, setShowResolved] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editFlagId, setEditFlagId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [draftCitations, setDraftCitations] = useState('[]');
  const [editingContentFlag, setEditingContentFlag] = useState<FlaggedContentQueueItem | null>(null);
  const [busySugIds, setBusySugIds] = useState<Map<string, 'accepted' | 'declined'>>(new Map());

  const { data: sources = [], isLoading: sourcesLoading } = useQuery({
    queryKey: ['sources', hubId],
    queryFn: () => listSources(hubId),
    enabled: canModerate,
    staleTime: 0,
  });

  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery({
    queryKey: ['source-suggestions', hubId],
    queryFn: () => listSourceSuggestions({ hubId, status: 'pending' }),
    enabled: canModerate,
    staleTime: 0,
    refetchInterval: 10000,
  });

  const { data: acceptedSuggestions = [], isLoading: acceptedSuggestionsLoading } = useQuery({
    queryKey: ['source-suggestions', hubId, 'accepted'],
    queryFn: () => listSourceSuggestions({ hubId, status: 'accepted' }),
    enabled: canModerate && sugTab === 'reviewed',
    staleTime: 0,
  });

  const { data: declinedSuggestions = [], isLoading: declinedSuggestionsLoading } = useQuery({
    queryKey: ['source-suggestions', hubId, 'declined'],
    queryFn: () => listSourceSuggestions({ hubId, status: 'declined' }),
    enabled: canModerate && sugTab === 'reviewed',
    staleTime: 0,
  });

  const reviewedSuggestions = useMemo(
    () => [...acceptedSuggestions, ...declinedSuggestions].sort(
      (a, b) => new Date(b.reviewed_at ?? b.created_at).getTime() - new Date(a.reviewed_at ?? a.created_at).getTime(),
    ),
    [acceptedSuggestions, declinedSuggestions],
  );

  const { data: openFlags = [], isLoading: openFlagsLoading } = useQuery({
    queryKey: ['flagged-chats', hubId, 'open'],
    queryFn: () => listFlaggedChats(hubId, { status: 'open' }),
    enabled: canModerate,
    refetchInterval: 5000,
  });

  const { data: inReviewFlags = [], isLoading: inReviewFlagsLoading } = useQuery({
    queryKey: ['flagged-chats', hubId, 'in_review'],
    queryFn: () => listFlaggedChats(hubId, { status: 'in_review' }),
    enabled: canModerate,
    refetchInterval: 5000,
  });

  const { data: resolvedFlags = [], isLoading: resolvedFlagsLoading } = useQuery({
    queryKey: ['flagged-chats', hubId, 'resolved'],
    queryFn: () => listFlaggedChats(hubId, { status: 'resolved' }),
    enabled: canModerate,
    staleTime: 0,
  });

  const { data: dismissedFlags = [], isLoading: dismissedFlagsLoading } = useQuery({
    queryKey: ['flagged-chats', hubId, 'dismissed'],
    queryFn: () => listFlaggedChats(hubId, { status: 'dismissed' }),
    enabled: canModerate,
    staleTime: 0,
  });

  const { data: openContentFlags = [], isLoading: openContentFlagsLoading } = useQuery({
    queryKey: ['flagged-content', hubId, 'open'],
    queryFn: () => listFlaggedContent(hubId, { status: 'open' }),
    enabled: canModerate,
    refetchInterval: 10000,
  });

  const { data: resolvedContentFlags = [], isLoading: resolvedContentFlagsLoading } = useQuery({
    queryKey: ['flagged-content', hubId, 'resolved'],
    queryFn: () => listFlaggedContent(hubId, { status: 'resolved' }),
    enabled: canModerate,
    staleTime: 0,
  });

  const { data: dismissedContentFlags = [], isLoading: dismissedContentFlagsLoading } = useQuery({
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
    () => [
      ...resolvedFlags,
      ...dismissedFlags,
      ...resolvedContentFlags.map((f) => ({ ...f, session_title: f.title, question_preview: f.preview })),
      ...dismissedContentFlags.map((f) => ({ ...f, session_title: f.title, question_preview: f.preview })),
    ].sort(
      (a, b) => new Date(b.flagged_at).getTime() - new Date(a.flagged_at).getTime(),
    ),
    [resolvedFlags, dismissedFlags, resolvedContentFlags, dismissedContentFlags],
  );

  const decideSuggestionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accepted' | 'declined' }) =>
      decideSourceSuggestion(id, { action }),
    onMutate: ({ id, action }) => {
      setBusySugIds((prev) => new Map(prev).set(id, action));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['source-suggestions', hubId] });
      queryClient.invalidateQueries({ queryKey: ['sources', hubId] });
    },
    onSettled: (_data, _err, variables) => {
      setBusySugIds((prev) => {
        const next = new Map(prev);
        next.delete(variables.id);
        return next;
      });
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

  const openEditModal = async (flagId: string) => {
    setEditFlagId(flagId);
    setEditModalOpen(true);
    try {
      const detail = await getFlaggedChat(hubId, flagId);
      setDraftContent(detail.flagged_message.content);
      setDraftCitations(JSON.stringify(detail.flagged_message.citations));
    } catch {
      setDraftContent('');
      setDraftCitations('[]');
    }
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
  const statsLoading = sourcesLoading
    || openFlagsLoading
    || inReviewFlagsLoading
    || openContentFlagsLoading
    || resolvedFlagsLoading
    || dismissedFlagsLoading
    || resolvedContentFlagsLoading
    || dismissedContentFlagsLoading;
  const suggestionsPanelLoading = sugTab === 'pending'
    ? suggestionsLoading
    : acceptedSuggestionsLoading || declinedSuggestionsLoading;
  const moderationPanelLoading = modTab === 'chats'
    ? openFlagsLoading || inReviewFlagsLoading
    : openContentFlagsLoading;

  return (
    <div className="admin">
      {activeAdminTab === 'analytics' ? (
        <>
          <h2 className="admin__title">Analytics</h2>
          <HubAnalyticsPanel hubId={hubId} hubRole={hubRole} />
        </>
      ) : (
      <>
      <h2 className="admin__title">Admin Console</h2>

      <div className="admin__stats">
        {statsLoading ? (
          Array.from({ length: 3 }, (_, index) => <AdminStatCardSkeleton key={index} index={index} />)
        ) : (
          <>
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
          </>
        )}
      </div>

      <div className="admin__main">
        <div className="admin__column">
          <div className="admin__panel-header">
            <h3 className="admin__panel-title">Suggested Sources</h3>
          </div>
          <div className="admin__mod-tabs">
            <button
              type="button"
              className={`admin__mod-tab${sugTab === 'pending' ? ' admin__mod-tab--active' : ''}`}
              onClick={() => setSugTab('pending')}
            >
              Pending
              {suggestions.length > 0 && (
                <span className="admin__mod-tab-badge">{suggestions.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`admin__mod-tab${sugTab === 'reviewed' ? ' admin__mod-tab--active' : ''}`}
              onClick={() => setSugTab('reviewed')}
            >
              Reviewed
            </button>
          </div>
          <div className="admin__panel-body">
            {sugTab === 'pending' && (
              suggestionsPanelLoading ? (
                Array.from({ length: 3 }, (_, index) => <AdminSuggestionRowSkeleton key={index} index={index} />)
              ) : suggestions.length === 0 ? (
                <div className="admin__section-empty">
                  <LightBulbIcon className="admin__empty-icon" />
                  <p className="admin__empty-title">No pending suggestions</p>
                  <p className="admin__empty-subtitle">AI-generated source suggestions will appear here for review.</p>
                </div>
              ) : (
                suggestions.map((s) => (
                  <SuggestionRow
                    key={s.id}
                    suggestion={s}
                    onAccept={() => decideSuggestionMutation.mutate({ id: s.id, action: 'accepted' })}
                    onDecline={() => decideSuggestionMutation.mutate({ id: s.id, action: 'declined' })}
                    disabled={busySugIds.has(s.id)}
                    busyAction={busySugIds.get(s.id)}
                  />
                ))
              )
            )}
            {sugTab === 'reviewed' && (
              suggestionsPanelLoading ? (
                Array.from({ length: 3 }, (_, index) => <AdminSuggestionRowSkeleton key={index} index={index} />)
              ) : reviewedSuggestions.length === 0 ? (
                <div className="admin__section-empty">
                  <CheckIcon className="admin__empty-icon" />
                  <p className="admin__empty-title">No reviewed suggestions yet</p>
                  <p className="admin__empty-subtitle">Accepted and declined suggestions will appear here.</p>
                </div>
              ) : (
                reviewedSuggestions.map((s) => (
                  <SuggestionRow
                    key={s.id}
                    suggestion={s}
                    onAccept={() => {}}
                    onDecline={() => {}}
                    disabled
                    reviewed
                  />
                ))
              )
            )}
          </div>
        </div>

        <div className="admin__column">
          <div className="admin__panel-header">
            <h3 className="admin__panel-title">Chat Moderation</h3>
          </div>
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
              moderationPanelLoading ? (
                Array.from({ length: 3 }, (_, index) => <AdminModerationRowSkeleton key={index} index={index} />)
              ) : pendingChats.length === 0 ? (
                <p className="admin__section-empty">No flagged chats to review.</p>
              ) : (
                pendingChats.map((item) => (
                  <ChatFlagRow
                    key={item.id}
                    item={item}
                    onRegenerate={() => regenerateMutation.mutate(item.id)}
                    onEdit={() => openEditModal(item.id)}
                    onDismiss={() => dismissMutation.mutate(item.id)}
                    regenerating={regenerateMutation.isPending}
                    dismissing={dismissMutation.isPending}
                  />
                ))
              )
            )}

            {modTab === 'faqs' && (
              moderationPanelLoading ? (
                Array.from({ length: 3 }, (_, index) => <AdminModerationRowSkeleton key={index} index={index} />)
              ) : pendingFaqs.length === 0 ? (
                <p className="admin__section-empty">No flagged FAQs to review.</p>
              ) : (
                pendingFaqs.map((item) => (
                  <ContentFlagRow
                    key={item.id}
                    item={item}
                    onEdit={() => setEditingContentFlag(item)}
                    onResolve={() => resolveContentMutation.mutate(item.id)}
                    onDismiss={() => dismissContentMutation.mutate(item.id)}
                    disabled={resolveContentMutation.isPending || dismissContentMutation.isPending}
                  />
                ))
              )
            )}

            {modTab === 'guides' && (
              moderationPanelLoading ? (
                Array.from({ length: 3 }, (_, index) => <AdminModerationRowSkeleton key={index} index={index} />)
              ) : pendingGuides.length === 0 ? (
                <p className="admin__section-empty">No flagged guides to review.</p>
              ) : (
                pendingGuides.map((item) => (
                  <ContentFlagRow
                    key={item.id}
                    item={item}
                    onEdit={() => setEditingContentFlag(item)}
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

      {editingContentFlag && (
        <ContentEditModal
          hubId={hubId}
          flag={editingContentFlag}
          onClose={() => setEditingContentFlag(null)}
        />
      )}
      </>
      )}
    </div>
  );
}

function SuggestionRow({ suggestion, onAccept, onDecline, disabled, reviewed, busyAction }: {
  suggestion: SourceSuggestion; onAccept: () => void; onDecline: () => void; disabled: boolean; reviewed?: boolean; busyAction?: 'accepted' | 'declined';
}) {
  const displayUrl = suggestion.canonical_url || suggestion.url;
  const shortUrl = displayUrl.replace(/^https?:\/\//, '').slice(0, 60);
  const typeLabel = suggestion.type === 'youtube' ? 'YouTube' : 'Article';
  return (
    <div className={`admin__sug-row admin__sug-row--${suggestion.type}`}>
      <div className="admin__sug-row-icon">
        {suggestion.type === 'youtube' ? 'YT' : 'WEB'}
      </div>
      <div className="admin__sug-row-content">
        <div className="admin__sug-row-header">
          <span className="admin__sug-row-title">{suggestion.title || shortUrl}</span>
          <span className={`admin__sug-row-badge admin__sug-row-badge--${suggestion.type}`}>{typeLabel}</span>
        </div>
        <a className="admin__sug-row-url" href={displayUrl} target="_blank" rel="noopener noreferrer">{shortUrl}</a>
        {suggestion.rationale && (
          <p className="admin__sug-row-reason">AI Reasoning: {suggestion.rationale}</p>
        )}
      </div>
      {reviewed ? (
        <span className={`admin__sug-row-status admin__sug-row-status--${suggestion.status}`}>
          {suggestion.status === 'accepted' ? <CheckIcon /> : <XMarkIcon />}
          {suggestion.status === 'accepted' ? 'Accepted' : 'Declined'}
        </span>
      ) : (
        <div className="admin__sug-row-actions">
          <button className="admin__sug-row-btn admin__sug-row-btn--accept" type="button" title="Accept" onClick={onAccept} disabled={disabled}>
            {busyAction === 'accepted' ? <span className="admin__sug-row-spinner" /> : <CheckIcon />}
          </button>
          <button className="admin__sug-row-btn admin__sug-row-btn--decline" type="button" title="Decline" onClick={onDecline} disabled={disabled}>
            {busyAction === 'declined' ? <span className="admin__sug-row-spinner" /> : <XMarkIcon />}
          </button>
        </div>
      )}
    </div>
  );
}

const REASON_LABELS: Record<string, string> = {
  incorrect: 'Hallucination',
  unsupported: 'Unsupported Claim',
  harmful: 'Harmful Content',
  outdated: 'Outdated Information',
  other: 'Other',
};

function ChatFlagRow({ item, onRegenerate, onEdit, onDismiss, regenerating, dismissing }: {
  item: FlaggedChatQueueItem; onRegenerate: () => void; onEdit: () => void; onDismiss: () => void; regenerating: boolean; dismissing: boolean;
}) {
  const isActive = ['open', 'in_review'].includes(item.status);
  const reasonLabel = REASON_LABELS[item.reason] || item.reason;
  return (
    <div className="admin__flag-card">
      <div className="admin__flag-card-top">
        <span className={`admin__flag-badge admin__flag-badge--${item.status}`}>
          Flagged: {reasonLabel}
        </span>
        <span className="admin__flag-time">{new Date(item.flagged_at).toLocaleDateString('en-IE')}</span>
      </div>

      <div className="admin__flag-section">
        <p className="admin__flag-label">Original Prompt</p>
        <p className="admin__flag-text">&ldquo;{item.question_preview}&rdquo;</p>
      </div>

      <div className="admin__flag-section">
        <p className="admin__flag-label">AI Response</p>
        <p className="admin__flag-text">&ldquo;{item.answer_preview}&rdquo;</p>
      </div>

      <div className="admin__flag-section">
        <p className="admin__flag-label">Flag Reasons</p>
        <p className="admin__flag-reason-text">{reasonLabel}</p>
      </div>

      <div className="admin__flag-actions">
        <button className="admin__flag-btn admin__flag-btn--primary" type="button" onClick={onRegenerate} disabled={regenerating || !isActive}>
          <ArrowPathIcon />
          {regenerating ? 'Regenerating...' : 'Regenerate'}
        </button>
        <button className="admin__flag-btn" type="button" onClick={onEdit} disabled={!isActive}>
          <PencilSquareIcon />
          Edit Manually
        </button>
        <button className="admin__flag-btn admin__flag-btn--danger" type="button" onClick={onDismiss} disabled={dismissing || !isActive}>
          Ignore
        </button>
      </div>
    </div>
  );
}

function ContentFlagRow({ item, onEdit, onResolve, onDismiss, disabled }: {
  item: FlaggedContentQueueItem; onEdit: () => void; onResolve: () => void; onDismiss: () => void; disabled: boolean;
}) {
  const reasonLabel = REASON_LABELS[item.reason] || item.reason;
  const typeLabel = item.content_type === 'faq' ? 'FAQ' : 'Guide';
  return (
    <div className="admin__flag-card">
      <div className="admin__flag-card-top">
        <span className={`admin__flag-badge admin__flag-badge--${item.status}`}>
          Flagged: {reasonLabel}
        </span>
        <span className="admin__flag-time">{new Date(item.flagged_at).toLocaleDateString('en-IE')}</span>
      </div>

      <div className="admin__flag-section">
        <p className="admin__flag-label">{typeLabel} Title</p>
        <p className="admin__flag-text">&ldquo;{item.title}&rdquo;</p>
      </div>

      {item.preview && (
        <div className="admin__flag-section">
          <p className="admin__flag-label">Preview</p>
          <p className="admin__flag-text">&ldquo;{item.preview}&rdquo;</p>
        </div>
      )}

      <div className="admin__flag-section">
        <p className="admin__flag-label">Flag Reason</p>
        <p className="admin__flag-reason-text">{reasonLabel}</p>
      </div>

      <div className="admin__flag-actions">
        <button className="admin__flag-btn admin__flag-btn--primary" type="button" onClick={onEdit} disabled={disabled}>
          <PencilSquareIcon />
          Edit
        </button>
        <button className="admin__flag-btn" type="button" onClick={onResolve} disabled={disabled}>
          <CheckIcon />
          Resolve
        </button>
        <button className="admin__flag-btn admin__flag-btn--danger" type="button" onClick={onDismiss} disabled={disabled}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

interface StepDraft { title: string; instruction: string }

function ContentEditModal({
  hubId,
  flag,
  onClose,
}: {
  hubId: string;
  flag: FlaggedContentQueueItem;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isFaq = flag.content_type === 'faq';

  const faqsQuery = useQuery({
    queryKey: ['faqs', hubId],
    queryFn: () => listFaqs(hubId),
    enabled: isFaq,
    staleTime: 0,
  });
  const guidesQuery = useQuery({
    queryKey: ['guides', hubId],
    queryFn: () => listGuides(hubId),
    enabled: !isFaq,
    staleTime: 0,
  });

  const faq: FaqEntry | undefined = isFaq ? faqsQuery.data?.find((f) => f.id === flag.content_id) : undefined;
  const guide: GuideEntry | undefined = !isFaq ? guidesQuery.data?.find((g) => g.id === flag.content_id) : undefined;

  const [faqDraft, setFaqDraft] = useState<{ question: string; answer: string } | null>(null);
  const [titleDraft, setTitleDraft] = useState<string>('');
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraft>>({});
  const [newStep, setNewStep] = useState<StepDraft>({ title: '', instruction: '' });
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isFaq && faq && hydratedId !== faq.id) {
      setFaqDraft({ question: faq.question, answer: faq.answer });
      setHydratedId(faq.id);
    }
    if (!isFaq && guide && hydratedId !== guide.id) {
      setTitleDraft(guide.title);
      const drafts: Record<string, StepDraft> = {};
      for (const s of guide.steps) drafts[s.id] = { title: s.title ?? '', instruction: s.instruction };
      setStepDrafts(drafts);
      setHydratedId(guide.id);
    }
  }, [isFaq, faq, guide, hydratedId]);

  const saveFaq = async (alsoResolve: boolean) => {
    if (!faq || !faqDraft) {
      setError('FAQ data not loaded yet.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updates: { question?: string; answer?: string } = {};
      if (faqDraft.question.trim() !== faq.question) updates.question = faqDraft.question.trim();
      if (faqDraft.answer.trim() !== faq.answer) updates.answer = faqDraft.answer.trim();
      if (Object.keys(updates).length > 0) {
        await updateFaq(faq.id, updates);
      }
      if (alsoResolve) await resolveContentFlag(hubId, flag.id);
      queryClient.invalidateQueries({ queryKey: ['faqs', hubId] });
      queryClient.invalidateQueries({ queryKey: ['flagged-content', hubId] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveGuide = async (alsoResolve: boolean) => {
    if (!guide) return;
    setSaving(true);
    setError(null);
    try {
      if (titleDraft.trim() && titleDraft.trim() !== guide.title) {
        await updateGuide(guide.id, { title: titleDraft.trim() });
      }
      for (const step of guide.steps) {
        const d = stepDrafts[step.id];
        if (!d) continue;
        const newTitle = d.title.trim() || undefined;
        const oldTitle = step.title || undefined;
        const newInstr = d.instruction.trim();
        if (newTitle !== oldTitle || newInstr !== step.instruction) {
          if (!newInstr) throw new Error(`Step ${step.step_index}: instructions cannot be blank.`);
          await updateGuideStep(step.id, { title: newTitle, instruction: newInstr });
        }
      }
      if (newStep.instruction.trim()) {
        await createGuideStep(guide.id, {
          title: newStep.title.trim() || undefined,
          instruction: newStep.instruction.trim(),
        });
        setNewStep({ title: '', instruction: '' });
      }
      if (alsoResolve) await resolveContentFlag(hubId, flag.id);
      queryClient.invalidateQueries({ queryKey: ['guides', hubId] });
      queryClient.invalidateQueries({ queryKey: ['flagged-content', hubId] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const loading = isFaq ? faqsQuery.isLoading : guidesQuery.isLoading;
  const loaded = isFaq ? !!faqsQuery.data : !!guidesQuery.data;
  const notFound = loaded && !(isFaq ? faq : guide);
  const onSave = (alsoResolve: boolean) => (isFaq ? saveFaq(alsoResolve) : saveGuide(alsoResolve));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="gmodal" onClick={(e) => e.stopPropagation()}>
        <div className="gmodal__header">
          <span className="gmodal__badge">{isFaq ? 'FAQ' : 'GUIDE'}</span>
          <button className="gmodal__icon-btn" type="button" title="Close" onClick={onClose}>
            <XMarkIcon />
          </button>
        </div>

        {loading && <p className="admin__section-empty">Loading...</p>}
        {notFound && <p className="admin__section-empty">This item no longer exists. It may have been archived.</p>}

        {isFaq && faq && faqDraft && (
          <>
            <div className="faq-modal__question-section">
              <span className="faq-modal__label">QUESTION</span>
              <textarea
                className="hdash__form-input hdash__form-textarea faq-modal__edit-question"
                value={faqDraft.question}
                onChange={(e) => setFaqDraft({ ...faqDraft, question: e.target.value })}
                autoFocus
              />
            </div>
            <div className="faq-modal__answer-section">
              <div className="faq-modal__answer-header">
                <span className="faq-modal__label">ANSWER</span>
                <span className="faq-modal__confidence">{Math.round((faq.confidence || 0) * 100)}% confidence</span>
              </div>
              <textarea
                className="hdash__form-input hdash__form-textarea faq-modal__edit-answer"
                value={faqDraft.answer}
                onChange={(e) => setFaqDraft({ ...faqDraft, answer: e.target.value })}
              />
            </div>
          </>
        )}

        {!isFaq && guide && (
          <>
            <div className="gmodal__title-edit">
              <input
                type="text"
                className="hdash__form-input gmodal__title-input"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                placeholder="Guide title"
              />
            </div>

            <div className="gmodal__steps-header">
              <span className="gmodal__steps-label">STEP-BY-STEP</span>
              <span className="gmodal__steps-count">{guide.steps.length} steps</span>
            </div>

            <div className="gmodal__steps-list">
              {guide.steps.map((step, i) => {
                const d = stepDrafts[step.id] ?? { title: step.title ?? '', instruction: step.instruction };
                return (
                  <div key={step.id} className="gmodal__step">
                    <div className="gmodal__step-row">
                      <span className="gmodal__step-num">{i + 1}</span>
                      <div className="gmodal__step-content">
                        <div className="gmodal__step-edit-form">
                          <input
                            type="text"
                            className="hdash__form-input"
                            placeholder="Step title (optional)"
                            value={d.title}
                            onChange={(e) => setStepDrafts((p) => ({ ...p, [step.id]: { ...d, title: e.target.value } }))}
                          />
                          <textarea
                            className="hdash__form-input hdash__form-textarea"
                            placeholder="Step instructions"
                            value={d.instruction}
                            onChange={(e) => setStepDrafts((p) => ({ ...p, [step.id]: { ...d, instruction: e.target.value } }))}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="gmodal__add-step">
                <input
                  type="text"
                  className="hdash__form-input"
                  placeholder="New step title (optional)"
                  value={newStep.title}
                  onChange={(e) => setNewStep({ ...newStep, title: e.target.value })}
                />
                <textarea
                  className="hdash__form-input hdash__form-textarea"
                  placeholder="New step instructions (leave blank to skip adding)"
                  value={newStep.instruction}
                  onChange={(e) => setNewStep({ ...newStep, instruction: e.target.value })}
                />
              </div>
            </div>
          </>
        )}

        {error && (
          <p className="admin__edit-error">{error}</p>
        )}

        {(faq || guide) && (
          <div className="admin__edit-actions">
            <button className="admin__mod-btn" type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button
              className="admin__mod-btn"
              type="button"
              disabled={saving}
              onClick={() => onSave(false)}
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <button
              className="admin__mod-btn admin__mod-btn--primary"
              type="button"
              disabled={saving}
              onClick={() => onSave(true)}
            >
              {saving ? 'Saving...' : 'Save & Resolve flag'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
