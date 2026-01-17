'use client';

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { inviteMember, listMembers, removeMember, updateMemberRole } from "../lib/api";
import type { HubMember, MembershipRole } from "../lib/types";
import { useAuth } from "./auth/AuthProvider";

interface Props {
  hubId: string;
  role?: MembershipRole | null;
}

export function MembersPanel({ hubId, role }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MembershipRole>("viewer");

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
    mutationFn: (payload: { userId: string; role: MembershipRole }) =>
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

  const isOwner = role === "owner";

  return (
    <div className="card grid">
      <div>
        <h3 style={{ margin: 0 }}>Members</h3>
        <p className="muted">Manage roles and collaboration access for this hub.</p>
      </div>
      {isLoading && <p className="muted">Loading members...</p>}
      {error && <p className="muted">Failed to load members: {(error as Error).message}</p>}
      <div className="grid" style={{ gap: "10px" }}>
        {data?.map((member: HubMember) => {
          const isSelf = member.user_id === user?.id;
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
                  <select
                    value={member.role}
                    onChange={(event) =>
                      roleMutation.mutate({ userId: member.user_id, role: event.target.value as MembershipRole })
                    }
                    disabled={roleMutation.isPending}
                    style={{
                      background: "#0f1726",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      padding: "6px 10px",
                    }}
                  >
                    <option value="owner">Owner</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    className="button"
                    type="button"
                    onClick={() => removeMutation.mutate(member.user_id)}
                    disabled={removeMutation.isPending || isSelf}
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
            <p className="muted">User must already have a Caddie account.</p>
          </div>
          <label>
            <span className="muted">Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            <span className="muted">Role</span>
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as MembershipRole)}
              style={{
                background: "#0f1726",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "8px 10px",
              }}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button className="button" type="submit" disabled={inviteMutation.isPending}>
            {inviteMutation.isPending ? "Sending..." : "Send invite"}
          </button>
          {inviteMutation.error && <p className="muted">Invite failed: {(inviteMutation.error as Error).message}</p>}
        </form>
      )}
    </div>
  );
}
