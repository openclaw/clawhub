import { ArrowDownUp, Check, Grid3X3, List, Search, X } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { CONTENT_TAG_LABELS } from "../../lib/contentTags";
import { type SortDir, type SortKey } from "./-params";

type TagCount = { tag: string; count: number };

type SkillsToolbarProps = {
  searchInputRef: RefObject<HTMLInputElement | null>;
  query: string;
  hasQuery: boolean;
  sort: SortKey;
  dir: SortDir;
  view: "cards" | "list";
  highlightedOnly: boolean;
  nonSuspiciousOnly: boolean;
  activeTag?: string;
  popularTags: TagCount[];
  onQueryChange: (next: string) => void;
  onToggleHighlighted: () => void;
  onToggleNonSuspicious: () => void;
  onTagChange: (tag: string | undefined) => void;
  onSortChange: (value: string) => void;
  onToggleDir: () => void;
  onToggleView: () => void;
};

export function SkillsToolbar({
  searchInputRef,
  query,
  hasQuery,
  sort,
  dir,
  view,
  highlightedOnly,
  nonSuspiciousOnly,
  activeTag,
  popularTags,
  onQueryChange,
  onToggleHighlighted,
  onToggleNonSuspicious,
  onTagChange,
  onSortChange,
  onToggleDir,
  onToggleView,
}: SkillsToolbarProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Search row */}
      <div className="relative">
        <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[color:var(--ink-soft)]" />
        <Input
          ref={searchInputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search skills by name, slug, or summary..."
          className="pl-10 pr-10"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-[color:var(--ink-soft)] transition-colors hover:text-[color:var(--ink)]"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filters + sort row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Boolean filter chips */}
        <FilterChip active={highlightedOnly} onClick={onToggleHighlighted}>
          Staff Picks
        </FilterChip>
        <FilterChip active={nonSuspiciousOnly} onClick={onToggleNonSuspicious}>
          Clean only
        </FilterChip>

        {/* Tag filter chips — data-driven, only the most popular */}
        {popularTags.length > 0 && (
          <>
            <div className="mx-0.5 h-5 w-px bg-[color:var(--line)]" aria-hidden="true" />
            {popularTags.map(({ tag, count }) => (
              <TagChip
                key={tag}
                active={activeTag === tag}
                onClick={() => onTagChange(activeTag === tag ? undefined : tag)}
                count={count}
              >
                {CONTENT_TAG_LABELS[tag] ?? tag}
              </TagChip>
            ))}
          </>
        )}

        {/* Spacer */}
        <div className="ml-auto" />

        {/* Sort */}
        <Select value={sort} onValueChange={onSortChange}>
          <SelectTrigger
            className="w-auto min-w-[140px] min-h-[36px] py-1.5 text-xs font-semibold"
            aria-label="Sort skills"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hasQuery ? <SelectItem value="relevance">Relevance</SelectItem> : null}
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="downloads">Downloads</SelectItem>
            <SelectItem value="installs">Installs</SelectItem>
            <SelectItem value="stars">Stars</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleDir}
          aria-label={`Sort direction: ${dir === "asc" ? "ascending" : "descending"}`}
          className="min-h-[36px] px-2"
        >
          <ArrowDownUp
            className={`h-4 w-4 transition-transform ${dir === "asc" ? "rotate-180" : ""}`}
          />
        </Button>

        {/* View toggle */}
        <div className="inline-flex items-center rounded-[var(--radius-pill)] border border-[color:var(--line)] bg-[color:var(--surface)] p-0.5">
          <button
            type="button"
            onClick={view === "list" ? onToggleView : undefined}
            className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-full transition-colors ${
              view === "cards"
                ? "bg-[color:var(--accent)] text-white"
                : "text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
            }`}
            aria-label="Grid view"
          >
            <Grid3X3 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={view === "cards" ? onToggleView : undefined}
            className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-full transition-colors ${
              view === "list"
                ? "bg-[color:var(--accent)] text-white"
                : "text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
            }`}
            aria-label="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
        active
          ? "border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
          : "border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink-soft)] hover:border-[color:var(--border-ui-hover)] hover:text-[color:var(--ink)]"
      }`}
    >
      {active && <Check className="h-3 w-3" />}
      {children}
    </button>
  );
}

function TagChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-[0.7rem] font-medium transition-all duration-150 ${
        active
          ? "border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
          : "border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink-soft)] hover:border-[color:var(--border-ui-hover)] hover:text-[color:var(--ink)]"
      }`}
    >
      {active && <Check className="h-2.5 w-2.5" />}
      {children}
      <span
        className={`text-[0.6rem] tabular-nums ${active ? "text-[color:var(--accent)]/60" : "text-[color:var(--ink-soft)]/50"}`}
      >
        {count}
      </span>
    </button>
  );
}
