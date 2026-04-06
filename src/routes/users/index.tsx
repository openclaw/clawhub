import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { UserListItem } from "../../components/UserListItem";
import type { PublicUser } from "../../lib/publicUser";

type UserSearchState = {
  q?: string;
};

export const Route = createFileRoute("/users/")({
  validateSearch: (search): UserSearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
  }),
  component: UsersIndex,
});

function UsersIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState(search.q ?? "");

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  const result = useQuery(api.users.listPublic, {
    limit: 48,
    search: search.q,
  }) as { items: PublicUser[]; total: number } | undefined;

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
      <form
        className="browse-page-search"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({
            search: {
              q: query.trim() || undefined,
            },
          });
        }}
      >
        <Search size={15} className="navbar-search-icon" aria-hidden="true" />
        <input
          className="browse-search-input"
          placeholder="Search users..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>

      <div className="browse-results">
        <div className="browse-results-toolbar">
          <span className="browse-results-count">
            {result === undefined ? "Loading users..." : `${users.length} users`}
          </span>
        </div>

        {result === undefined ? (
          <div className="card">
            <div className="loading-indicator">Loading users...</div>
          </div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">No users found</p>
            <p className="empty-state-body">Try a different handle or name.</p>
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
