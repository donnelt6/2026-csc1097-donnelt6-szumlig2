'use client';

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { inviteMember, listMembers, removeMember, transferHubOwnership, updateMemberRole } from "../lib/api";
import type { AssignableMembershipRole, HubMember, MembershipRole } from "../lib/types";
import { useAuth } from "./auth/AuthProvider";

interface Props {
  hubId: string;
  role?: MembershipRole | null;
}

const ASSIGNABLE_ROLES: AssignableMembershipRole[] = ["admin", "editor", "viewer"];

export function MembersPanel({ hubId, role }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableMembershipRole>("viewer");
  const [transferTargetId, setTransferTargetId] = useState<string>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["members", hubId],
    queryFn: () => listMembers(hubId),
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteMember(hubId, { email, role: inviteRole }),
    onSuccess: () => {
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["members", hubId] });
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });

  const roleMutation = useMutation({
    mutationFn: (payload: { userId: string; role: AssignableMembershipRole }) =>
      updateMemberRole(hubId, payload.userId, { role: payload.role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", hubId] });
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(hubId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", hubId] });
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });

  const transferMutation = useMutation({
    mutationFn: (userId: string) => transferHubOwnership(hubId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", hubId] });
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });

  const isOwner = role === "owner";
  const acceptedAdmins = useMemo(
    () => (data ?? []).filter((member) => member.accepted_at && member.role === "admin"),
    [data]
  );

  return (
    <div className="card grid">
      <div>
        <h3 style={{ margin: 0 }}>Members</h3>
        <p className="muted">Manage hub roles, invites, and ownership transfer.</p>
      </div>
      {isLoading && <p className="muted">Loading members...</p>}
      {error && <p className="muted">Failed to load members: {(error as Error).message}</p>}
      <div className="grid" style={{ gap: "10px" }}>
        {data?.map((member: HubMember) => {
          const isSelf = member.user_id === user?.id;
          const isMemberOwner = member.role === "owner";
          return (
            <div key={member.user_id} className="card" style={{ borderColor: "#1e2535" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                <div>
                  <strong>{member.email ?? member.user_id.slice(0, 8)}</strong>
                  <p className="muted" style={{ margin: 0 }}>
                    {member.accepted_at ? "Active member" : "Pending invite"}
                  </p>
                </div>
                <span className="role-pill">{member.role}</span>
              </div>
              {isOwner && (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                  {isMemberOwner ? (
                    <span className="muted" style={{ fontSize: "0.85rem" }}>Owner role is fixed.</span>
                  ) : (
                    <select
                      value={member.role}
                      onChange={(event) =>
                        roleMutation.mutate({
                          userId: member.user_id,
                          role: event.target.value as AssignableMembershipRole,
                        })
                      }
                      disabled={roleMutation.isPending}
                      style={{
                        background: "var(--input-bg)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        padding: "6px 10px",
                      }}
                    >
                      {ASSIGNABLE_ROLES.map((assignableRole) => (
                        <option key={assignableRole} value={assignableRole}>
                          {assignableRole.charAt(0).toUpperCase() + assignableRole.slice(1)}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="button"
                    type="button"
                    onClick={() => removeMutation.mutate(member.user_id)}
                    disabled={removeMutation.isPending || isSelf || isMemberOwner}
                  >
                    {isSelf ? "You" : "Remove"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {isOwner && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!email.trim()) return;
              inviteMutation.mutate();
            }}
            className="grid"
          >
            <div>
              <h4 style={{ margin: "8px 0" }}>Invite an existing user</h4>
              <p className="muted">Invite users as admins, editors, or viewers.</p>
            </div>
            <label>
              <span className="muted">Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
            </label>
            <label>
              <span className="muted">Role</span>
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as AssignableMembershipRole)}
                style={{
                  background: "var(--input-bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "8px 10px",
                }}
              >
                {ASSIGNABLE_ROLES.map((assignableRole) => (
                  <option key={assignableRole} value={assignableRole}>
                    {assignableRole.charAt(0).toUpperCase() + assignableRole.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button" type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? "Sending..." : "Send invite"}
            </button>
            {inviteMutation.error && <p className="muted">Invite failed: {(inviteMutation.error as Error).message}</p>}
          </form>

          <div className="grid">
            <div>
              <h4 style={{ margin: "8px 0" }}>Transfer ownership</h4>
              <p className="muted">Ownership can only transfer to an accepted admin. The current owner becomes an admin.</p>
            </div>
            <label>
              <span className="muted">Target admin</span>
              <select
                value={transferTargetId}
                onChange={(event) => setTransferTargetId(event.target.value)}
                style={{
                  background: "var(--input-bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "8px 10px",
                }}
              >
                <option value="">Select an admin</option>
                {acceptedAdmins.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.email ?? member.user_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button"
              type="button"
              disabled={!transferTargetId || transferMutation.isPending}
              onClick={() => transferMutation.mutate(transferTargetId)}
            >
              {transferMutation.isPending ? "Transferring..." : "Transfer ownership"}
            </button>
            {transferMutation.error && (
              <p className="muted">Transfer failed: {(transferMutation.error as Error).message}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
