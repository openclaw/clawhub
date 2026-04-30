import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Card } from "../../components/ui/card";
import { UserListItem } from "../../components/UserListItem";
import { convexHttp } from "../../convex/client";
import type { PublicUser } from "../../lib/publicUser";

type UsersLoaderResult = { items: PublicUser[]; total: number };

export const Route = createFileRoute("/users/")({
  component: UsersIndex,
});

function UsersIndex() {
  const [result, setResult] = useState<UsersLoaderResult | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await convexHttp.query(api.users.listPublic, {
        limit: 48,
      });
      setResult(data as UsersLoaderResult);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const users = result?.items ?? [];

  return (
    <main className="browse-page">
      <div className="browse-page-header">
        <h1 className="browse-title">
          Users
          {typeof result?.total === "number" ? (
            <span className="browse-count">{result.total}</span>
          ) : null}
        </h1>
      </div>

      <div className="browse-results">
        <div className="browse-results-toolbar">
          <span className="browse-results-count">
            {loading ? "Loading users..." : `${users.length} users`}
          </span>
        </div>

        {loading ? (
          <Card>
            <div className="loading-indicator">Loading users...</div>
          </Card>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">No users yet</p>
          </div>
        ) : (
          <div className="results-list">
            {users.map((user) => (
              <UserListItem key={user._id} user={user} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
