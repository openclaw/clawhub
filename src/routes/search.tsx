import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";
import { PluginListItem } from "../components/PluginListItem";
import { SkillListItem } from "../components/SkillListItem";
import { UserListItem } from "../components/UserListItem";
import type { PublicSkill, PublicUser } from "../lib/publicUser";
import {
  useUnifiedSearch,
  type UnifiedPluginResult,
  type UnifiedSkillResult,
  type UnifiedUserResult,
} from "../lib/useUnifiedSearch";

type SearchState = {
  q?: string;
  type?: "all" | "skills" | "plugins" | "users";
};

export const Route = createFileRoute("/search")({
  validateSearch: (search): SearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    type:
      search.type === "skills" || search.type === "plugins" || search.type === "users"
        ? search.type
        : undefined,
  }),
  component: UnifiedSearchPage,
});

function UnifiedSearchPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const activeType = search.type ?? "all";
  const [query, setQuery] = useState(search.q ?? "");

  const { results, skillCount, pluginCount, userCount, isSearching } = useUnifiedSearch(
    search.q ?? "",
    activeType,
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      to: "/search",
      search: { q: query.trim() || undefined, type: search.type },
    });
  };

  const setType = (type: "all" | "skills" | "plugins" | "users") => {
    void navigate({
      to: "/search",
      search: { q: search.q, type: type === "all" ? undefined : type },
      replace: true,
    });
  };

  return (
    <main className="browse-page">
      <h1 className="browse-title" style={{ marginBottom: 16 }}>
        {search.q ? (
          <>
            Search results for <span style={{ color: "var(--accent)" }}>"{search.q}"</span>
          </>
        ) : (
          "Search"
        )}
      </h1>

      <form className="search-page-form" onSubmit={handleSearch}>
        <div className="browse-search-bar" style={{ maxWidth: 560, flex: 1 }}>
            <Search size={16} className="navbar-search-icon" aria-hidden="true" />
          <input
            className="browse-search-input"
            type="text"
            placeholder="Search skills, plugins, users..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      </form>

      <div className="search-tabs">
        <button
          className={`search-tab${activeType === "all" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("all")}
        >
          All
        </button>
        <button
          className={`search-tab${activeType === "skills" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("skills")}
        >
          Skills
          {skillCount > 0 ? (
            <span className="search-tab-count">{skillCount}</span>
          ) : null}
        </button>
        <button
          className={`search-tab${activeType === "plugins" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("plugins")}
        >
          Plugins
          {pluginCount > 0 ? (
            <span className="search-tab-count">{pluginCount}</span>
          ) : null}
        </button>
        <button
          className={`search-tab${activeType === "users" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("users")}
        >
          Users
          {userCount > 0 ? <span className="search-tab-count">{userCount}</span> : null}
        </button>
      </div>

      {isSearching ? (
        <div className="card">
          <div className="loading-indicator">Searching...</div>
        </div>
      ) : !search.q ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ color: "var(--ink-soft)" }}>
            Enter a search term to find skills, plugins, and users
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ color: "var(--ink-soft)" }}>No results found for "{search.q}"</p>
        </div>
      ) : (
        <div className="results-list">
          {results.map((item) =>
            item.type === "skill" ? (
              <SkillResultRow key={`skill-${item.skill._id}`} result={item} />
            ) : item.type === "plugin" ? (
              <PluginResultRow key={`plugin-${item.plugin.name}`} result={item} />
            ) : (
              <UserResultRow key={`user-${item.user._id}`} result={item} />
            ),
          )}
        </div>
      )}
    </main>
  );
}

function SkillResultRow({ result }: { result: UnifiedSkillResult }) {
  const skill = result.skill as unknown as PublicSkill;
  return (
    <SkillListItem
      skill={skill}
      ownerHandle={result.ownerHandle}
    />
  );
}

function PluginResultRow({ result }: { result: UnifiedPluginResult }) {
  return <PluginListItem item={result.plugin} />;
}

function UserResultRow({ result }: { result: UnifiedUserResult }) {
  const user = result.user as PublicUser;
  return <UserListItem user={user} />;
}
