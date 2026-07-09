import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowDownUp, LayoutGrid, List, Star } from "lucide-react";
import { startTransition, useOptimistic } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { EmptyState } from "../components/EmptyState";
import { SignInPrompt } from "../components/SignInPrompt";
import { StarsSkeleton } from "../components/skeletons/ProtectedPageSkeletons";
import { SkillCard } from "../components/SkillCard";
import { SkillListItem } from "../components/SkillListItem";
import { SkillStatsTripletLine } from "../components/SkillStats";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { getSkillBadges } from "../lib/badges";
import type { PublicSkill } from "../lib/publicUser";
import { useAuthStatus } from "../lib/useAuthStatus";

type StarsView = "grid" | "list";
type StarsSort = "starred" | "updated" | "stars";
type OptimisticStarsAction =
  | { type: "remove"; skillId: PublicSkill["_id"] }
  | { type: "restore"; skill: PublicSkill };

const STARRED_SKILLS_LIMIT = 50;

export const Route = createFileRoute("/stars")({
  validateSearch: (search): { view?: StarsView; sort?: StarsSort } => ({
    view: search.view === "list" ? "list" : undefined,
    sort: ["starred", "updated", "stars"].includes(search.sort as string)
      ? (search.sort as StarsSort)
      : undefined,
  }),
  component: Stars,
});

export function Stars() {
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();

  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeView: StarsView = search.view ?? "grid";
  const activeSort: StarsSort = search.sort ?? "starred";

  const skillsQuery = useQuery(
    api.stars.listByUser,
    me ? { userId: me._id as Doc<"users">["_id"], limit: STARRED_SKILLS_LIMIT } : "skip",
  ) as PublicSkill[] | undefined;
  const toggleStar = useMutation(api.stars.toggle);

  const [optimisticSkills, updateOptimisticSkills] = useOptimistic(
    skillsQuery ?? [],
    (state: PublicSkill[], action: OptimisticStarsAction) => {
      if (action.type === "remove") return state.filter((s) => s._id !== action.skillId);
      if (state.some((s) => s._id === action.skill._id)) return state;
      return [action.skill, ...state];
    },
  );
  const canSortCompleteSet = skillsQuery !== undefined && skillsQuery.length < STARRED_SKILLS_LIMIT;
  const effectiveSort = canSortCompleteSet ? activeSort : "starred";

  const skills = [...optimisticSkills].sort((a, b) => {
    if (effectiveSort === "updated") return b.updatedAt - a.updatedAt;
    if (effectiveSort === "stars") return b.stats.stars - a.stats.stars;
    return 0; // "starred" keeps server order (starredAt desc)
  });
  const hasStars = skills.length > 0;

  const handleUnstar = (skill: PublicSkill) => {
    startTransition(() => {
      updateOptimisticSkills({ type: "remove", skillId: skill._id });
    });
    toggleStar({ skillId: skill._id }).catch((err: Error) => {
      startTransition(() => {
        updateOptimisticSkills({ type: "restore", skill });
      });
      console.error("Failed to unstar skill:", err);
      toast.error("Unable to unstar this skill. Please try again.");
    });
  };

  if (isAuthLoading) {
    return <StarsSkeleton />;
  }

  if (!isAuthenticated || !me) {
    return (
      <SignInPrompt
        icon={Star}
        title="Sign in to see your highlights"
        description="Star skills for quick access later."
      />
    );
  }

  if (skillsQuery === undefined) {
    return <StarsSkeleton />;
  }

  return (
    <main className="browse-page">
      <header className="stars-header">
        <h1 className="stars-header-title font-display text-3xl font-black leading-none text-[color:var(--ink)]">
          Your highlights
        </h1>
        {hasStars ? (
          <div className="stars-header-controls">
            <Select
              value={effectiveSort}
              disabled={!canSortCompleteSet}
              onValueChange={(value) => {
                void navigate({
                  to: "/stars",
                  search: { ...search, sort: value as StarsSort },
                  resetScroll: false,
                });
              }}
            >
              <SelectTrigger
                className="stars-sort-trigger h-8 min-w-[140px] text-xs font-semibold"
                aria-label="Sort starred skills"
              >
                <ArrowDownUp className="mr-1.5 h-3.5 w-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="starred">Recently starred</SelectItem>
                <SelectItem value="updated" disabled={!canSortCompleteSet}>
                  Recently updated
                </SelectItem>
                <SelectItem value="stars" disabled={!canSortCompleteSet}>
                  Most stars
                </SelectItem>
              </SelectContent>
            </Select>
            <nav
              className="publisher-filter-tabs publisher-view-tabs stars-view-tabs"
              aria-label="Starred skills view"
            >
              <Link
                to="/stars"
                search={{ ...search, view: undefined }}
                resetScroll={false}
                className={`publisher-filter-tab${activeView === "grid" ? " is-active" : ""}`}
                aria-label="Grid view"
              >
                <LayoutGrid size={14} aria-hidden="true" />
              </Link>
              <Link
                to="/stars"
                search={{ ...search, view: "list" }}
                resetScroll={false}
                className={`publisher-filter-tab${activeView === "list" ? " is-active" : ""}`}
                aria-label="List view"
              >
                <List size={14} aria-hidden="true" />
              </Link>
            </nav>
          </div>
        ) : null}
      </header>
      <Separator className="mb-6" />

      {skills.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No stars yet"
          description="Browse skills and star your favorites."
          action={{ label: "Browse skills", href: "/skills" }}
        />
      ) : activeView === "grid" ? (
        <div className="stars-grid">
          {skills.map((skill) => {
            const ownerId = String(skill.ownerPublisherId ?? skill.ownerUserId);
            const href = `/${encodeURIComponent(ownerId)}/${encodeURIComponent(skill.slug)}`;
            return (
              <div key={skill._id} className="stars-card-shell">
                <SkillCard
                  skill={skill}
                  href={href}
                  badge={getSkillBadges(skill)}
                  summaryFallback="Agent-ready skill pack."
                  meta={<SkillStatsTripletLine stats={skill.stats} />}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleUnstar(skill);
                  }}
                  aria-label={`Unstar ${skill.displayName}`}
                  className="stars-card-unstar text-[color:var(--gold)] hover:text-status-error-fg"
                >
                  <Star className="h-4 w-4 fill-current" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="results-list">
          {skills.map((skill) => (
            <div key={skill._id} className="relative">
              <SkillListItem skill={skill} />
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleUnstar(skill);
                }}
                aria-label={`Unstar ${skill.displayName}`}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--gold)] hover:text-status-error-fg"
              >
                <Star className="h-4 w-4 fill-current" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
