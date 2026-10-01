import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { formatTimestamp, type ManagementUserListResult } from "./managementShared";

type ManagementRole = "admin" | "moderator" | "user";

export function UsersPage({
  currentUserId,
  filteredUsers,
  search,
  summary,
  userEmptyLabel,
  onBanUser,
  onChangeSearch,
  onSetRole,
  onUnbanUser,
}: {
  currentUserId: Id<"users"> | null;
  filteredUsers: ManagementUserListResult["items"];
  search: string;
  summary: string;
  userEmptyLabel: string;
  onBanUser: (userId: Id<"users">, label: string) => void;
  onChangeSearch: (value: string) => void;
  onSetRole: (userId: Id<"users">, role: ManagementRole) => void;
  onUnbanUser: (userId: Id<"users">, label: string) => void;
}) {
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">Users</h2>
      <p className="section-subtitle m-0 mt-1">
        Staff and member accounts. Search by handle, change a role, or ban an account.
      </p>
      <div className="management-controls">
        <div className="management-control management-search">
          <span className="mono">Filter</span>
          <input
            type="search"
            placeholder="Search users"
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
          />
        </div>
        <div className="management-count">{summary}</div>
      </div>
      <div className="management-list">
        {filteredUsers.length === 0 ? (
          <div className="management-empty">{userEmptyLabel}</div>
        ) : (
          filteredUsers.map((user) => {
            const removed = Boolean(user.deletedAt || user.deactivatedAt);
            const removedAt = user.deactivatedAt ?? user.deletedAt ?? user._creationTime;
            const label = `@${user.handle ?? user.name ?? "user"}`;
            return (
              <div
                key={user._id}
                className={removed ? "management-item is-removed" : "management-item"}
              >
                <div className="management-item-main">
                  <span className="mono">@{user.handle ?? user.name ?? "user"}</span>
                  <div className="management-item-meta">
                    {removed
                      ? user.banReason && user.deletedAt
                        ? `Banned ${formatTimestamp(user.deletedAt)} · ${user.banReason}`
                        : `Deleted ${formatTimestamp(removedAt)}`
                      : `${user.role ?? "user"} · joined ${formatTimestamp(user._creationTime)}`}
                  </div>
                </div>
                <div className="management-actions">
                  <Select
                    value={user.role ?? "user"}
                    onValueChange={(value) => {
                      if (value === "admin" || value === "moderator" || value === "user") {
                        onSetRole(user._id, value);
                      }
                    }}
                  >
                    <SelectTrigger size="sm" className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="moderator">Moderator</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={user._id === currentUserId}
                    onClick={() => {
                      if (user._id === currentUserId) return;
                      onBanUser(user._id, label);
                    }}
                  >
                    Ban user
                  </Button>
                  {user.deletedAt && !user.deactivatedAt ? (
                    <Button type="button" onClick={() => onUnbanUser(user._id, label)}>
                      Unban user
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
