import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { ManagementAccessNotice } from "../../components/ManagementAccessNotice";
import { PluginOperationsNav } from "../../components/PluginOperationsNav";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { isAdmin } from "../../lib/roles";
import { useAuthStatus } from "../../lib/useAuthStatus";

type UserRole = "admin" | "moderator" | "user";
type UserListResult = {
  items: Doc<"users">[];
  total: number;
};

export const Route = createFileRoute("/management/users")({
  component: UserManagementRoute,
});

export function UserManagementRoute() {
  const { me } = useAuthStatus();
  const admin = isAdmin(me);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const [activeWrite, setActiveWrite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const users = useQuery(
    api.users.list,
    admin ? { limit, search: search.trim() || undefined } : "skip",
  ) as UserListResult | undefined;
  const setRole = useMutation(api.users.setRole);
  const banUser = useMutation(api.users.banUser);
  const unbanUser = useMutation(api.users.unbanUser);

  if (!admin) {
    return <ManagementAccessNotice me={me} />;
  }

  const items = users?.items ?? [];
  const changeRole = (user: Doc<"users">, role: UserRole) => {
    const label = formatUserLabel(user);
    const currentRole = (user.role ?? "user") as UserRole;
    if (role === currentRole) return;
    if (
      !window.confirm(
        `Set ${label} role from ${currentRole} to ${role}?\n\nThis writes users.setRole in Convex.`,
      )
    ) {
      return;
    }
    setError(null);
    setActiveWrite(`role:${user._id}`);
    void setRole({ userId: user._id, role })
      .catch((requestError) => setError(formatMutationError(requestError)))
      .finally(() => setActiveWrite(null));
  };
  const runBan = (user: Doc<"users">) => {
    if (user._id === me?._id) return;
    const label = formatUserLabel(user);
    if (
      !window.confirm(
        `Ban ${label} and delete their skills?\n\nThis writes users.banUser in Convex.`,
      )
    ) {
      return;
    }
    const reason = window.prompt(`Ban reason for ${label}. Required.`);
    const trimmed = reason?.trim();
    if (!trimmed) return;
    setError(null);
    setActiveWrite(`ban:${user._id}`);
    void banUser({ userId: user._id, reason: trimmed })
      .catch((requestError) => setError(formatMutationError(requestError)))
      .finally(() => setActiveWrite(null));
  };
  const runUnban = (user: Doc<"users">) => {
    const label = formatUserLabel(user);
    if (!window.confirm(`Unban ${label}?\n\nThis writes users.unbanUser in Convex.`)) return;
    const reason = window.prompt(`Unban reason for ${label}. Required.`);
    const trimmed = reason?.trim();
    if (!trimmed) return;
    setError(null);
    setActiveWrite(`unban:${user._id}`);
    void unbanUser({ userId: user._id, reason: trimmed })
      .catch((requestError) => setError(formatMutationError(requestError)))
      .finally(() => setActiveWrite(null));
  };

  return (
    <main className="section">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="section-title">User roles</h1>
          <p className="section-subtitle">
            Admin-only user search, moderator setup, role changes, and ban recovery.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/management" search={{ skill: undefined, plugin: undefined }}>
            Back to management
          </Link>
        </Button>
      </div>

      <PluginOperationsNav current="users" />

      <Card>
        <div className="management-controls">
          <label className="management-control management-search">
            <span className="mono">Search</span>
            <input
              type="search"
              placeholder="handle, name, email, or user id"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="management-control">
            <span className="mono">Limit</span>
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(event) => setLimit(Number.parseInt(event.target.value, 10) || 1)}
            />
          </label>
          <div className="management-count">
            {users ? `${items.length} shown / ${users.total} matched` : "Loading users..."}
          </div>
        </div>
        {error ? (
          <div className="mt-3">
            <Badge variant="destructive">{error}</Badge>
          </div>
        ) : null}
      </Card>

      <Card className="mt-5">
        <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
          Role assignments
        </h2>
        <div className="management-list mt-3">
          {users === undefined ? (
            <div className="stat">Loading users...</div>
          ) : items.length === 0 ? (
            <div className="stat">No matching users.</div>
          ) : (
            items.map((user) => (
              <div className="management-item" key={user._id}>
                <div className="management-item-main">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono">{formatUserLabel(user)}</span>
                    <Badge variant={roleBadgeVariant(user.role)}>{user.role ?? "user"}</Badge>
                    {user.deletedAt ? <Badge variant="destructive">banned</Badge> : null}
                    {user.deactivatedAt ? <Badge variant="compact">deactivated</Badge> : null}
                  </div>
                  <div className="section-subtitle m-0">
                    {user.email ?? user.name ?? user._id} - joined{" "}
                    {formatTimestamp(user.createdAt ?? user._creationTime)}
                  </div>
                  {user.banReason ? (
                    <div className="management-report-item">
                      <span className="management-report-meta">ban reason</span>
                      <span>{user.banReason}</span>
                    </div>
                  ) : null}
                </div>
                <div className="management-actions">
                  <select
                    value={user.role ?? "user"}
                    disabled={activeWrite === `role:${user._id}`}
                    onChange={(event) => changeRole(user, event.target.value as UserRole)}
                  >
                    <option value="user">User</option>
                    <option value="moderator">Moderator</option>
                    <option value="admin">Admin</option>
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    disabled={user._id === me?._id || activeWrite === `ban:${user._id}`}
                    onClick={() => runBan(user)}
                  >
                    Ban
                  </Button>
                  {user.deletedAt && !user.deactivatedAt ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={activeWrite === `unban:${user._id}`}
                      onClick={() => runUnban(user)}
                    >
                      Unban
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </main>
  );
}

function roleBadgeVariant(role: Doc<"users">["role"]) {
  if (role === "admin") return "destructive";
  if (role === "moderator") return "warning";
  return "compact";
}

function formatUserLabel(user: Pick<Doc<"users">, "_id" | "handle" | "name">) {
  return `@${user.handle ?? user.name ?? user._id}`;
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

function formatMutationError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Request failed.";
}
