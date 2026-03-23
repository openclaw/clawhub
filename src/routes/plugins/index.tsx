import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchPackages, type PackageListItem } from "../../lib/packageApi";
import { familyLabel, packageCapabilityLabel } from "../../lib/packageLabels";

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
    const data = await fetchPackages({
      q: deps.q,
      cursor: deps.q ? undefined : deps.cursor,
      family: deps.family,
      isOfficial: deps.verified,
      executesCode: deps.executesCode,
      limit: deps.verified ? 10 : 50,
    });
    const allItems = "results" in data ? data.results.map((entry) => entry.package) : data.items;
    const items = allItems.filter((item) => item.family !== "skill");
    return {
      items,
      nextCursor: "results" in data ? null : data.nextCursor,
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
          Code plugins and bundle plugins for OpenClaw.
        </p>
      </header>

      <div className="card" style={{ display: "grid", gap: 12, marginBottom: 18 }}>
        <form
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
          style={{ display: "grid", gap: 12 }}
        >
          <input
            className="input"
            placeholder="Search plugins"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <select
              className="input"
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
            >
              <option value="">All plugins</option>
              <option value="code-plugin">Code plugins</option>
              <option value="bundle-plugin">Bundle plugins</option>
            </select>
            <label className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={search.verified ?? false}
                onChange={(event) => {
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      cursor: undefined,
                      verified: event.target.checked || undefined,
                    }),
                  });
                }}
              />
              Verified only
            </label>
            <label className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={search.executesCode ?? false}
                onChange={(event) => {
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      cursor: undefined,
                      executesCode: event.target.checked || undefined,
                    }),
                  });
                }}
              />
              Executes code
            </label>
            <Link className="btn" to="/plugins/new">
              Publish Plugin
            </Link>
          </div>
        </form>
      </div>

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
                className="skill-card"
              >
                <div className="skill-card-tags">
                  <span className="tag">{familyLabel(item.family)}</span>
                  {item.executesCode ? (
                    <span className="tag tag-accent">
                      {packageCapabilityLabel(item.family, item.executesCode)}
                    </span>
                  ) : null}
                  {item.verificationTier ? <span className="tag">{item.verificationTier}</span> : null}
                </div>
                <div className="skill-card-title">{item.displayName}</div>
                <div className="skills-row-slug">{item.name}</div>
                <div className="skill-card-summary">
                  {item.summary ?? "No summary provided."}
                </div>
                <div className="skill-card-footer skill-card-footer-inline">
                  <div className="stat">
                    {item.ownerHandle ? `by ${item.ownerHandle}` : "community plugin"}
                    {item.latestVersion ? ` · v${item.latestVersion}` : ""}
                  </div>
                  {item.isOfficial ? <VerifiedBadge /> : null}
                </div>
              </Link>
            ))}
          </div>
          {!search.q && (search.cursor || nextCursor) ? (
            <div
              className="card"
              style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between", marginTop: 18 }}
            >
              <div className="section-subtitle" style={{ margin: 0 }}>
                Browsing {items.length} plugin{items.length === 1 ? "" : "s"} per page.
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
