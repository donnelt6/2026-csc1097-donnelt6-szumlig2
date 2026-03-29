'use client';

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PlusIcon,
  XMarkIcon,
  TrashIcon,
  ShieldCheckIcon,
  PencilSquareIcon,
  EyeIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { inviteMember, listMembers, removeMember, transferHubOwnership, updateMemberRole } from "../lib/api";
import { resolveProfile } from "../lib/profile";
import { useSearch } from "../lib/SearchContext";
import type { AssignableMembershipRole, HubMember, MembershipRole } from "../lib/types";
import { useAuth } from "./auth/AuthProvider";
import { ProfileAvatar } from "./profile/ProfileAvatar";

interface Props {
  hubId: string;
  role?: MembershipRole | null;
}

const ASSIGNABLE_ROLES: AssignableMembershipRole[] = ["admin", "editor", "viewer"];
const MAX_MEMBERS = 20;

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function RoleDropdown({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: { value: string; label: string; subtitle?: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="members__dropdown" ref={ref}>
      <button
        type="button"
        className="members__dropdown-btn"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
      >
        <span className={selected?.subtitle ? "members__dropdown-selected" : ""}>
          <span>{selected?.label ?? value}</span>
          {selected?.subtitle && (
            <span className="members__dropdown-subtitle">{selected.subtitle}</span>
          )}
        </span>
        <ChevronDownIcon className="members__dropdown-chevron" />
      </button>
      {open && (
        <div className="members__dropdown-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`members__dropdown-item${opt.value === value ? " members__dropdown-item--active" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span>{opt.label}</span>
              {opt.subtitle && (
                <span className="members__dropdown-subtitle">{opt.subtitle}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type RoleFilter = "all" | MembershipRole;
type StatusFilter = "all" | "active" | "pending";

export function MembersPanel({ hubId, role }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { searchQuery } = useSearch();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableMembershipRole>("viewer");
  const [transferTargetId, setTransferTargetId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout>>();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deletingMemberIds, setDeletingMemberIds] = useState<Set<string>>(new Set());
  const pendingDeletes = useRef(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ["members", hubId],
    queryFn: () => listMembers(hubId),
  });

  const showStatus = (text: string, type: "success" | "error") => {
    clearTimeout(statusTimer.current);
    setStatusMessage({ text, type });
    statusTimer.current = setTimeout(() => setStatusMessage(null), 4000);
  };

  const inviteMutation = useMutation({
    mutationFn: () => inviteMember(hubId, { email, role: inviteRole }),
    onSuccess: () => {
      setEmail("");
      setInviteRole("viewer");
      setShowInviteModal(false);
      queryClient.invalidateQueries({ queryKey: ["members", hubId] });
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
      showStatus("Invite sent successfully.", "success");
    },
    onError: (err: Error) => {
      showStatus(`Invite failed: ${err.message}`, "error");
    },
  });

  const roleMutation = useMutation({
    mutationFn: (payload: { userId: string; role: AssignableMembershipRole }) =>
      updateMemberRole(hubId, payload.userId, { role: payload.role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", hubId] });
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
      showStatus("Role updated.", "success");
    },
  });

  const handleRemoveMember = async (userId: string, displayName: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Remove ${displayName} from this hub?`);
      if (!confirmed) return;
    }
    setDeletingMemberIds((prev) => new Set(prev).add(userId));
    pendingDeletes.current++;
    try {
      await removeMember(hubId, userId);
      showStatus("Member removed.", "success");
    } catch (err) {
      setDeletingMemberIds((prev) => { const next = new Set(prev); next.delete(userId); return next; });
      showStatus(`Remove failed: ${(err as Error).message}`, "error");
    } finally {
      pendingDeletes.current--;
      // Once all pending deletes are done, do a single refetch to sync
      if (pendingDeletes.current === 0) {
        queryClient.invalidateQueries({ queryKey: ["members", hubId] });
        queryClient.invalidateQueries({ queryKey: ["hubs"] });
      }
    }
  };

  const transferMutation = useMutation({
    mutationFn: (userId: string) => transferHubOwnership(hubId, userId),
    onSuccess: () => {
      setShowTransferModal(false);
      setTransferTargetId("");
      queryClient.invalidateQueries({ queryKey: ["members", hubId] });
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
      showStatus("Ownership transferred.", "success");
    },
    onError: (err: Error) => {
      showStatus(`Transfer failed: ${err.message}`, "error");
    },
  });

  const isOwner = role === "owner";
  const acceptedAdmins = useMemo(
    () => (data ?? []).filter((member) => member.accepted_at && member.role === "admin"),
    [data]
  );

  const memberCount = data?.length ?? 0;
  const roleOptions = ASSIGNABLE_ROLES.map((r) => ({ value: r, label: capitalize(r) }));

  const filteredMembers = useMemo(() => {
    let members = data ?? [];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      members = members.filter((m) => {
        const name = resolveProfile(m).displayName.toLowerCase();
        const identifier = (m.email ?? m.user_id).toLowerCase();
        return name.includes(q) || identifier.includes(q);
      });
    }
    if (roleFilter !== "all") {
      members = members.filter((m) =>
        roleFilter === "admin" ? m.role === "admin" || m.role === "owner" : m.role === roleFilter
      );
    }
    if (statusFilter !== "all") {
      members = members.filter((m) =>
        statusFilter === "active" ? !!m.accepted_at : !m.accepted_at
      );
    }
    return members;
  }, [data, searchQuery, roleFilter, statusFilter]);

  const roleCounts = useMemo(() => {
    const members = data ?? [];
    return {
      all: members.length,
      owner: members.filter((m) => m.role === "owner").length,
      admin: members.filter((m) => m.role === "admin" || m.role === "owner").length,
      editor: members.filter((m) => m.role === "editor").length,
      viewer: members.filter((m) => m.role === "viewer").length,
    };
  }, [data]);

  const statusCounts = useMemo(() => {
    const members = data ?? [];
    return {
      all: members.length,
      active: members.filter((m) => !!m.accepted_at).length,
      pending: members.filter((m) => !m.accepted_at).length,
    };
  }, [data]);

  return (
    <div className="members">
      {/* Toast */}
      {statusMessage && (
        <p className={`members__status members__status--${statusMessage.type}`}>
          {statusMessage.text}
        </p>
      )}

      <h2 className="members__title">Hub Members</h2>
      <div className="members__subtitle-row">
        <p className="members__description">
          Manage hub roles, invites, and ownership transfer.
        </p>
        <div className="members__header-actions">
          {isOwner && acceptedAdmins.length > 0 && (
            <button
              className="button button--danger members__transfer-btn"
              type="button"
              onClick={() => setShowTransferModal(true)}
            >
              Transfer Ownership
            </button>
          )}
          {isOwner && (
            <button
              className="button button--primary members__invite-btn"
              type="button"
              onClick={() => setShowInviteModal(true)}
            >
              <PlusIcon className="members__btn-icon" />
              Invite Member
            </button>
          )}
        </div>
      </div>

      {isLoading && <p className="muted">Loading members...</p>}
      {error && <p className="muted">Failed to load members: {(error as Error).message}</p>}

      {/* Filter pills */}
      {memberCount > 0 && (
        <div className="members__toolbar">
          <div className="members__filter-groups">
            <div className="members__filter-pills">
              {(["all", "owner", "admin", "editor", "viewer"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`members__filter-pill${roleFilter === r ? " members__filter-pill--active" : ""}`}
                  onClick={() => setRoleFilter(r)}
                >
                  {capitalize(r)} ({roleCounts[r]})
                </button>
              ))}
            </div>
            <div className="members__filter-pills">
              {(["all", "active", "pending"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`members__filter-pill${statusFilter === s ? " members__filter-pill--active" : ""}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {capitalize(s)} ({statusCounts[s]})
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Table header */}
      {filteredMembers.length > 0 && (
        <div className="members__table-header">
          <span>Member</span>
          <span>Role</span>
          <span>Status</span>
          <span className="members__th--actions">Actions</span>
        </div>
      )}

      <div className="members__layout">
        {/* Main content */}
        <div className="members__main">
          {/* Member rows */}
          <div className="members__table-body">
            {memberCount > 0 && filteredMembers.length === 0 && (
              <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>
                No members match the current filters.
              </p>
            )}
            {filteredMembers.map((member: HubMember) => {
              const isSelf = member.user_id === user?.id;
              const isMemberOwner = member.role === "owner";
              const isDeleting = deletingMemberIds.has(member.user_id);
              const profile = resolveProfile(member);
              const displayName = profile.displayName;
              const emailOrId = member.email ?? member.user_id;
              const showEmail = emailOrId !== displayName;
              const isActive = !!member.accepted_at;

              return (
                <div key={member.user_id} className="members__row">
                  {/* Member cell */}
                  <div className="members__cell members__cell--member">
                    <ProfileAvatar className="members__avatar" profile={member} />
                    <div className="members__member-details">
                      <span className="members__member-name">{displayName}</span>
                      {showEmail && <span className="members__member-email">{emailOrId}</span>}
                      {isSelf && <span className="members__you-badge">You</span>}
                    </div>
                  </div>

                  {/* Role cell */}
                  <div className="members__cell members__cell--role">
                    {isOwner && !isMemberOwner ? (
                      <RoleDropdown
                        value={member.role}
                        options={roleOptions}
                        disabled={roleMutation.isPending}
                        onChange={(newRole) =>
                          roleMutation.mutate({
                            userId: member.user_id,
                            role: newRole as AssignableMembershipRole,
                          })
                        }
                      />
                    ) : (
                      <span className="members__role-label">
                        {capitalize(member.role)}
                      </span>
                    )}
                  </div>

                  {/* Status cell */}
                  <div className="members__cell members__cell--status">
                    {isDeleting ? (
                      <span className="members__status-badge members__status-badge--deleting">
                        <span className="members__status-spinner" />
                        Removing
                      </span>
                    ) : (
                      <span className={`members__status-badge members__status-badge--${isActive ? "active" : "pending"}`}>
                        <span className={`members__status-dot members__status-dot--${isActive ? "active" : "pending"}`} />
                        {isActive ? "Active" : "Pending"}
                      </span>
                    )}
                  </div>

                  {/* Actions cell */}
                  <div className="members__cell members__cell--actions">
                    {isOwner && !isSelf && !isMemberOwner && (
                      <button
                        className="members__action-btn members__action-btn--danger"
                        type="button"
                        title="Remove member"
                        onClick={() => handleRemoveMember(member.user_id, displayName)}
                        disabled={isDeleting}
                      >
                        <TrashIcon className="members__action-icon" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        </div>

        {/* Sidebar */}
        <aside className="members__sidebar">
          <div className="members__info-card">
            <h4 className="members__info-title">Hub Roles & Permissions</h4>

            <div className="members__info-item">
              <div className="members__info-icon members__info-icon--admin">
                <ShieldCheckIcon style={{ width: 18, height: 18 }} />
              </div>
              <div>
                <strong className="members__info-role">Admins</strong>
                <p className="members__info-desc">
                  Full access to hub settings, member management, and all content.
                </p>
              </div>
            </div>

            <div className="members__info-item">
              <div className="members__info-icon members__info-icon--editor">
                <PencilSquareIcon style={{ width: 18, height: 18 }} />
              </div>
              <div>
                <strong className="members__info-role">Editors</strong>
                <p className="members__info-desc">
                  Can create, edit, and organise documents in the Vault.
                </p>
              </div>
            </div>

            <div className="members__info-item">
              <div className="members__info-icon members__info-icon--viewer">
                <EyeIcon style={{ width: 18, height: 18 }} />
              </div>
              <div>
                <strong className="members__info-role">Viewers</strong>
                <p className="members__info-desc">
                  Read-only access to sources. Cannot edit or invite others.
                </p>
              </div>
            </div>
          </div>

          <div className="members__capacity-card">
            <span className="members__capacity-label">Hub Capacity</span>
            <span className="members__capacity-count">
              {memberCount} <span className="members__capacity-max">/ {MAX_MEMBERS}</span>
            </span>
            <div className="members__capacity-bar">
              <div
                className="members__capacity-fill"
                style={{ width: `${Math.min((memberCount / MAX_MEMBERS) * 100, 100)}%` }}
              />
            </div>
          </div>
        </aside>
      </div>

      {/* Invite modal */}
      {showInviteModal && (
        <div className="modal-backdrop" onClick={() => { setShowInviteModal(false); setEmail(""); setInviteRole("viewer"); }}>
          <div className="modal members__invite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div>
                <h3 className="modal__title">Invite Member</h3>
                <p className="modal__subtitle">Send an invite to an existing user.</p>
              </div>
            </div>
            <button
              className="modal__close"
              type="button"
              onClick={() => { setShowInviteModal(false); setEmail(""); setInviteRole("viewer"); }}
            >
              <XMarkIcon style={{ width: 20, height: 20 }} />
            </button>
            <form
              className="members__invite-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!email.trim()) return;
                inviteMutation.mutate();
              }}
            >
              <label className="members__form-label">
                <span className="members__form-label-text">Email address</span>
                <input
                  className="members__form-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="user@example.com"
                  autoFocus
                />
              </label>
              <div className="members__form-label">
                <span className="members__form-label-text">Role</span>
                <div className="members__invite-row">
                  <RoleDropdown
                    value={inviteRole}
                    options={roleOptions}
                    onChange={(v) => setInviteRole(v as AssignableMembershipRole)}
                  />
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={inviteMutation.isPending}
                  >
                    {inviteMutation.isPending ? "Sending..." : "Send invite"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer ownership modal */}
      {showTransferModal && (
        <div className="modal-backdrop" onClick={() => setShowTransferModal(false)}>
          <div className="modal members__transfer-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal__close"
              type="button"
              onClick={() => setShowTransferModal(false)}
            >
              <XMarkIcon style={{ width: 20, height: 20 }} />
            </button>
            <div className="modal__header">
              <div>
                <h3 className="modal__title">Transfer Ownership</h3>
                <p className="modal__subtitle">
                  Select an accepted admin to transfer ownership to. You will become an admin and this cannot be undone.
                </p>
              </div>
            </div>
            <div className="members__transfer-form">
              <span className="members__form-label-text">Target admin</span>
              <div className="members__transfer-row">
                <RoleDropdown
                  value={transferTargetId || ""}
                  options={[
                    { value: "", label: "Select an admin" },
                    ...acceptedAdmins.map((m) => {
                      const profile = resolveProfile(m);
                      const name = profile.displayName;
                      const email = m.email ?? "";
                      return {
                        value: m.user_id,
                        label: name,
                        subtitle: email && email !== name ? email : undefined,
                      };
                    }),
                  ]}
                  onChange={(id) => setTransferTargetId(id)}
                />
                <button
                  className="button button--danger"
                  type="button"
                  disabled={!transferTargetId || transferMutation.isPending}
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      const confirmed = window.confirm(
                        "Transfer ownership to this admin? You will become an admin, and you cannot undo this change from this screen."
                      );
                      if (!confirmed) return;
                    }
                    transferMutation.mutate(transferTargetId);
                  }}
                >
                  {transferMutation.isPending ? "Transferring..." : "Transfer ownership"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
