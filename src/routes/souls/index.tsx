import { createFileRoute, Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import { SkillCardSkeletonGrid } from "../../components/skeletons/SkillCardSkeleton";
import { SoulCard } from "../../components/SoulCard";
import { SoulMetricsRow, SoulStatsTripletLine } from "../../components/SoulStats";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { PublicSoul } from "../../lib/publicUser";

const sortKeys = ["newest", "downloads", "stars", "name", "updated"] as const;
type SortKey = (typeof sortKeys)[number];
type SortDir = "asc" | "desc";

function parseSort(value: unknown): SortKey {
  if (typeof value !== "string") return "newest";
  if ((sortKeys as readonly string[]).includes(value)) return value as SortKey;
  return "newest";
}

function parseDir(value: unknown, sort: SortKey): SortDir {
  if (value === "asc" || value === "desc") return value;
  return sort === "name" ? "asc" : "desc";
}

export const Route = createFileRoute("/souls/")({
  validateSearch: (search) => {
    return {
      q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
      sort: typeof search.sort === "string" ? parseSort(search.sort) : undefined,
      dir: search.dir === "asc" || search.dir === "desc" ? search.dir : undefined,
      view: search.view === "cards" || search.view === "list" ? search.view : undefined,
      focus: search.focus === "search" ? "search" : undefined,
    };
  },
  component: SoulsIndex,
});

function SoulsIndex() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const sort = search.sort ?? "newest";
  const dir = parseDir(search.dir, sort);
  const view = search.view ?? "list";
  const [query, setQuery] = useState(search.q ?? "");

  const souls = useQuery(api.souls.list, { limit: 500 }) as PublicSoul[] | undefined;
  const ensureSoulSeeds = useAction(api.seed.ensureSoulSeeds);
  const seedEnsuredRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isLoadingSouls = souls === undefined;

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  // Auto-focus search input when focus=search param is present
  useEffect(() => {
    if (search.focus === "search" && searchInputRef.current) {
      searchInputRef.current.focus();
      // Clear the focus param from URL to avoid re-focusing on navigation
      void navigate({ search: (prev) => ({ ...prev, focus: undefined }), replace: true });
    }
  }, [search.focus, navigate]);

  useEffect(() => {
    if (seedEnsuredRef.current) return;
    seedEnsuredRef.current = true;
    void ensureSoulSeeds({});
  }, [ensureSoulSeeds]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    const all = souls ?? [];
    if (!value) return all;
    return all.filter((soul) => {
      if (soul.slug.toLowerCase().includes(value)) return true;
      if (soul.displayName.toLowerCase().includes(value)) return true;
      return (soul.summary ?? "").toLowerCase().includes(value);
    });
  }, [query, souls]);

  const sorted = useMemo(() => {
    const multiplier = dir === "asc" ? 1 : -1;
    const results = [...filtered];
    results.sort((a, b) => {
      switch (sort) {
        case "downloads":
          return (a.stats.downloads - b.stats.downloads) * multiplier;
        case "stars":
          return (a.stats.stars - b.stats.stars) * multiplier;
        case "updated":
          return (a.updatedAt - b.updatedAt) * multiplier;
        case "name":
          return (
            (a.displayName.localeCompare(b.displayName) || a.slug.localeCompare(b.slug)) *
            multiplier
          );
        default:
          return (a.createdAt - b.createdAt) * multiplier;
      }
    });
    return results;
  }, [dir, filtered, sort]);

  const showing = sorted.length;
  const total = souls?.length;

  return (
    <main className="py-10">
      <Container>
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-[color:var(--ink)] mb-2">Souls</h1>
            <p className="text-sm text-[color:var(--ink-soft)]">
              {isLoadingSouls
                ? "Loading souls..."
                : `${showing}${typeof total === "number" ? ` of ${total}` : ""} souls.`}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <div className="relative flex items-center">
              <Search
                className="pointer-events-none absolute left-3 h-4 w-4 text-[color:var(--ink-soft)] opacity-50"
                aria-hidden="true"
              />
              <Input
                ref={searchInputRef}
                className="pl-9"
                value={query}
                onChange={(event) => {
                  const next = event.target.value;
                  const trimmed = next.trim();
                  setQuery(next);
                  void navigate({
                    search: (prev) => ({ ...prev, q: trimmed ? next : undefined }),
                    replace: true,
                  });
                }}
                placeholder="Filter by name, slug, or summary..."
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                className="min-h-[34px] rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] px-3 py-1.5 text-sm text-[color:var(--ink)] dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]"
                value={sort}
                onChange={(event) => {
                  const nextSort = parseSort(event.target.value);
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      sort: nextSort,
                      dir: parseDir(prev.dir, nextSort),
                    }),
                    replace: true,
                  });
                }}
                aria-label="Sort souls"
              >
                <option value="newest">Newest</option>
                <option value="updated">Recently updated</option>
                <option value="downloads">Downloads</option>
                <option value="stars">Stars</option>
                <option value="name">Name</option>
              </select>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Sort direction ${dir}`}
                onClick={() => {
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      dir: parseDir(prev.dir, sort) === "asc" ? "desc" : "asc",
                    }),
                    replace: true,
                  });
                }}
              >
                {dir === "asc" ? "\u2191" : "\u2193"}
              </Button>
              <Button
                variant={view === "cards" ? "primary" : "ghost"}
                size="sm"
                onClick={() => {
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      view: prev.view === "cards" ? undefined : "cards",
                    }),
                    replace: true,
                  });
                }}
              >
                {view === "cards" ? "List" : "Cards"}
              </Button>
            </div>
          </div>
        </header>

        <div className="mt-6">
          {isLoadingSouls ? (
            <SkillCardSkeletonGrid count={6} />
          ) : showing === 0 ? (
            <EmptyState
              title="No souls match that filter"
              description="Try a different search term."
            />
          ) : view === "cards" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
              {sorted.map((soul) => (
                <SoulCard
                  key={soul._id}
                  soul={soul}
                  summaryFallback="A SOUL.md bundle."
                  meta={
                    <div className="text-sm text-[color:var(--ink-soft)]">
                      <SoulStatsTripletLine stats={soul.stats} />
                    </div>
                  }
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sorted.map((soul) => (
                <Link
                  key={soul._id}
                  className="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-4 transition-all duration-200 hover:-translate-y-px hover:shadow-[0_10px_20px_rgba(29,26,23,0.12)]"
                  to="/souls/$slug"
                  params={{ slug: soul.slug }}
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-[color:var(--ink)]">
                        {soul.displayName}
                      </span>
                      <span className="text-sm text-[color:var(--ink-soft)]">/{soul.slug}</span>
                    </div>
                    <div className="text-sm text-[color:var(--ink-soft)]">
                      {soul.summary ?? "SOUL.md bundle."}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <SoulMetricsRow stats={soul.stats} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </Container>
    </main>
  );
}
