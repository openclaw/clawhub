import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchPluginCatalog, type PackageListItem } from "../../lib/packageApi";
import { familyLabel } from "../../lib/packageLabels";

type PluginSearchState = {
  q?: string;
  cursor?: string;
  family?: "code-plugin" | "bundle-plugin";
  verified?: boolean;
  executesCode?: boolean;
};

type PluginsLoaderData = {
  items: PackageListItem[];
  nextCursor: string | null;
};

export const Route = createFileRoute("/plugins/")({
  validateSearch: (search): PluginSearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
    cursor: typeof search.cursor === "string" && search.cursor ? search.cursor : undefined,
    family:
      search.family === "code-plugin" || search.family === "bundle-plugin"
        ? search.family
        : undefined,
    verified:
      search.verified === true || search.verified === "true" || search.verified === "1"
        ? true
        : undefined,
    executesCode:
      search.executesCode === true ||
      search.executesCode === "true" ||
      search.executesCode === "1"
        ? true
        : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const data = await fetchPluginCatalog({
      q: deps.q,
      cursor: deps.q ? undefined : deps.cursor,
      family: deps.family,
      isOfficial: deps.verified,
      executesCode: deps.executesCode,
      limit: 50,
    });
    return {
      items: data.items,
      nextCursor: data.nextCursor,
    } satisfies PluginsLoaderData;
  },
  component: PluginsIndex,
});

function VerifiedBadge() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Verified publisher"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
    >
      <path
        d="M8 0L9.79 1.52L12.12 1.21L12.93 3.41L15.01 4.58L14.42 6.84L15.56 8.82L14.12 10.5L14.12 12.82L11.86 13.41L10.34 15.27L8 14.58L5.66 15.27L4.14 13.41L1.88 12.82L1.88 10.5L0.44 8.82L1.58 6.84L0.99 4.58L3.07 3.41L3.88 1.21L6.21 1.52L8 0Z"
        fill="#3b82f6"
      />
      <path
        d="M5.5 8L7 9.5L10.5 6"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PluginsIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { items, nextCursor } = Route.useLoaderData() as PluginsLoaderData;
  const [query, setQuery] = useState(search.q ?? "");

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  return (
    <main className="section">
      <header className="skills-header-top">
        <h1 className="section-title" style={{ marginBottom: 8 }}>
          Plugins
        </h1>
        <p className="section-subtitle" style={{ marginBottom: 0 }}>
          Browse the plugin catalog.
        </p>
      </header>

      <form
        className="skills-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({
            search: (prev) => ({
              ...prev,
              cursor: undefined,
              q: query.trim() || undefined,
            }),
          });
        }}
      >
        <div className="skills-search">
          <input
            className="skills-search-input"
            placeholder="Search plugins…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="skills-toolbar-row">
          <select
            className="skills-sort"
            value={search.family ?? ""}
            onChange={(event) => {
              const value = event.target.value as PluginSearchState["family"] | "";
              void navigate({
                search: (prev) => ({
                  ...prev,
                  cursor: undefined,
                  family: value || undefined,
                }),
              });
            }}
            aria-label="Filter by type"
          >
            <option value="">All plugins</option>
            <option value="code-plugin">Code plugins</option>
            <option value="bundle-plugin">Bundle plugins</option>
          </select>
          <button
            className={`search-filter-button${search.verified ? " is-active" : ""}`}
            type="button"
            aria-pressed={search.verified ?? false}
            onClick={() => {
              void navigate({
                search: (prev) => ({
                  ...prev,
                  cursor: undefined,
                  verified: prev.verified ? undefined : true,
                }),
              });
            }}
          >
            Verified
          </button>
          <button
            className={`search-filter-button${search.executesCode ? " is-active" : ""}`}
            type="button"
            aria-pressed={search.executesCode ?? false}
            onClick={() => {
              void navigate({
                search: (prev) => ({
                  ...prev,
                  cursor: undefined,
                  executesCode: prev.executesCode ? undefined : true,
                }),
              });
            }}
          >
            Executes code
          </button>
          <Link className="btn btn-primary" to="/plugins/new">
            Publish
          </Link>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="card">No plugins match that filter.</div>
      ) : (
        <>
          <div className="grid">
            {items.map((item) => (
              <Link
                key={item.name}
                to="/plugins/$name"
                params={{ name: item.name }}
                className="card skill-card"
              >
                <div className="skill-card-tags">
                  <span className="tag tag-compact">{familyLabel(item.family)}</span>
                  {item.isOfficial ? (
                    <span className="tag tag-compact tag-accent">
                      <VerifiedBadge /> Verified
                    </span>
                  ) : null}
                </div>
                <h3 className="skill-card-title">{item.displayName}</h3>
                <p className="skill-card-summary">
                  {item.summary ?? "No summary provided."}
                </p>
                <div className="skill-card-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="stat">
                    {item.ownerHandle ? `by ${item.ownerHandle}` : "community"}
                  </span>
                  {item.latestVersion ? (
                    <span className="stat">v{item.latestVersion}</span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
          {!search.q && (search.cursor || nextCursor) ? (
            <div
              style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 22 }}
            >
              {search.cursor ? (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        cursor: undefined,
                      }),
                    });
                  }}
                >
                  First page
                </button>
              ) : null}
              {nextCursor ? (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        cursor: nextCursor,
                      }),
                    });
                  }}
                >
                  Next page
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
