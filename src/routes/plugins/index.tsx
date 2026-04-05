import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { formatRetryDelay } from "../../lib/formatRetryDelay";
import {
  fetchPluginCatalog,
  isRateLimitedPackageApiError,
  type PackageListItem,
} from "../../lib/packageApi";
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
  rateLimited: boolean;
  retryAfterSeconds: number | null;
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
      search.executesCode === true || search.executesCode === "true" || search.executesCode === "1"
        ? true
        : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    try {
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
        rateLimited: false,
        retryAfterSeconds: null,
      } satisfies PluginsLoaderData;
    } catch (error) {
      if (!isRateLimitedPackageApiError(error)) throw error;
      return {
        items: [],
        nextCursor: null,
        rateLimited: true,
        retryAfterSeconds: error.retryAfterSeconds,
      } satisfies PluginsLoaderData;
    }
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
      className="inline-block shrink-0 align-middle"
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
  const { items, nextCursor, rateLimited, retryAfterSeconds } =
    Route.useLoaderData() as PluginsLoaderData;
  const [query, setQuery] = useState(search.q ?? "");

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  return (
    <main className="py-10">
      <Container size="wide">
        <header className="mb-6">
          <h1 className="font-display text-2xl font-bold text-[color:var(--ink)] mb-2">Plugins</h1>
          <p className="text-sm text-[color:var(--ink-soft)]">Browse the plugin catalog.</p>
        </header>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <form
              className="relative flex flex-1 items-center"
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
              <Search
                className="pointer-events-none absolute left-3 h-4 w-4 text-[color:var(--ink-soft)] opacity-50"
                aria-hidden="true"
              />
              <Input
                className="pl-9"
                placeholder="Search plugins..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </form>
            <Link
              to="/publish-plugin"
              search={{
                ownerHandle: undefined,
                name: undefined,
                displayName: undefined,
                family: undefined,
                nextVersion: undefined,
                sourceRepo: undefined,
              }}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold text-sm min-h-[44px] rounded-[var(--radius-pill)] px-4 py-[11px] border-none bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--accent-deep)] text-white transition-all duration-200 no-underline hover:-translate-y-px hover:shadow-[0_10px_20px_rgba(29,26,23,0.12)]"
            >
              Publish Plugin
            </Link>
          </div>
          <div className="flex flex-wrap items-stretch gap-2">
            <div
              className="flex min-w-0 flex-wrap items-center rounded-[var(--radius-pill)] border border-[color:var(--line)]"
              role="group"
              aria-label="Filter by type"
            >
              {[
                { value: undefined, label: "All" },
                { value: "code-plugin" as const, label: "Code" },
                { value: "bundle-plugin" as const, label: "Bundles" },
              ].map((opt) => (
                <button
                  key={opt.label}
                  className={`flex-1 px-3 py-1.5 text-sm font-semibold transition-colors first:rounded-l-[var(--radius-pill)] last:rounded-r-[var(--radius-pill)] sm:flex-none ${
                    (search.family ?? undefined) === opt.value
                      ? "bg-[color:var(--accent)] text-white"
                      : "text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
                  }`}
                  type="button"
                  aria-pressed={(search.family ?? undefined) === opt.value}
                  onClick={() => {
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        cursor: undefined,
                        q: query.trim() || undefined,
                        family: opt.value,
                      }),
                    });
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Button
              variant={search.verified ? "primary" : "outline"}
              size="sm"
              className="flex-1 sm:flex-none"
              aria-pressed={search.verified ?? false}
              onClick={() => {
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    cursor: undefined,
                    q: query.trim() || undefined,
                    verified: prev.verified ? undefined : true,
                  }),
                });
              }}
            >
              <VerifiedBadge /> Verified
            </Button>
            <Button
              variant={search.executesCode ? "primary" : "outline"}
              size="sm"
              className="flex-1 sm:flex-none"
              aria-pressed={search.executesCode ?? false}
              onClick={() => {
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    cursor: undefined,
                    q: query.trim() || undefined,
                    executesCode: prev.executesCode ? undefined : true,
                  }),
                });
              }}
            >
              Executes code
            </Button>
          </div>
        </div>

        <div className="mt-6">
          {rateLimited ? (
            <EmptyState
              icon={AlertTriangle}
              title="Plugin catalog is temporarily unavailable"
              description={`The public plugin API is rate-limited right now. Try again ${formatRetryDelay(
                retryAfterSeconds,
              )}.`}
              action={{
                label: "Try again",
                onClick: () => window.location.reload(),
              }}
            />
          ) : items.length === 0 ? (
            <EmptyState
              title="No plugins match that filter"
              description="Try a different search or filter."
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] sm:gap-5">
                {items.map((item) => (
                  <Link key={item.name} to="/plugins/$name" params={{ name: item.name }}>
                    <Card className="h-full cursor-pointer hover:-translate-y-px hover:shadow-[0_10px_20px_rgba(29,26,23,0.12)]">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="compact">{familyLabel(item.family)}</Badge>
                        {item.isOfficial ? (
                          <Badge variant="accent">
                            <VerifiedBadge /> Verified
                          </Badge>
                        ) : null}
                      </div>
                      <h3 className="font-display text-lg font-bold text-[color:var(--ink)]">
                        {item.displayName}
                      </h3>
                      <p className="text-sm text-[color:var(--ink-soft)]">
                        {item.summary ?? "No summary provided."}
                      </p>
                      <div className="flex flex-col gap-1.5 pt-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="min-w-0 break-words text-sm text-[color:var(--ink-soft)]">
                          {item.ownerHandle ? `by ${item.ownerHandle}` : "community"}
                        </span>
                        {item.latestVersion ? (
                          <span className="text-sm text-[color:var(--ink-soft)]">
                            v{item.latestVersion}
                          </span>
                        ) : null}
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
              {!search.q && (search.cursor || nextCursor) ? (
                <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                  {search.cursor ? (
                    <Button
                      variant="outline"
                      className="w-full sm:w-auto"
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
                    </Button>
                  ) : null}
                  {nextCursor ? (
                    <Button
                      variant="primary"
                      className="w-full sm:w-auto"
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
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </Container>
    </main>
  );
}
