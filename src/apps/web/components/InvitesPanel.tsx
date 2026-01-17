'use client';

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acceptInvite, listInvites } from "../lib/api";

export function InvitesPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["invites"],
    queryFn: listInvites,
  });

  const acceptMutation = useMutation({
    mutationFn: (hubId: string) => acceptInvite(hubId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });

  return (
    <div className="card grid">
      <div>
        <h2 style={{ margin: "0 0 8px" }}>Invitations</h2>
        <p className="muted">Accept an invite to gain access to shared hubs.</p>
      </div>
      {isLoading && <p className="muted">Loading invites...</p>}
      {error && <p className="muted">Failed to load invites: {(error as Error).message}</p>}
      {!isLoading && !data?.length && <p className="muted">No pending invites.</p>}
      <div className="grid" style={{ gap: "10px" }}>
        {data?.map((invite) => (
          <div key={invite.hub.id} className="card" style={{ borderColor: "#1e2535" }}>
            <strong>{invite.hub.name}</strong>
            <p className="muted">{invite.hub.description || invite.hub.id}</p>
            <p className="muted">Role: {invite.role}</p>
            <button
              className="button"
              type="button"
              onClick={() => acceptMutation.mutate(invite.hub.id)}
              disabled={acceptMutation.isPending}
            >
              {acceptMutation.isPending ? "Accepting..." : "Accept invite"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
