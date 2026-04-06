import {
  ArrowDownUp,
  Check,
  Database,
  GitBranch,
  Grid3X3,
  List,
  MessageSquare,
  Package,
  Plug,
  Search,
  Shield,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { RefObject } from "react";
import { useMemo } from "react";
import { SKILL_CATEGORIES, type SkillCategory } from "../../lib/categories";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { type SortDir, type SortKey } from "./-params";

type SkillsToolbarProps = {
  searchInputRef: RefObject<HTMLInputElement | null>;
  query: string;
  hasQuery: boolean;
  sort: SortKey;
  dir: SortDir;
  view: "cards" | "list";
  highlightedOnly: boolean;
  nonSuspiciousOnly: boolean;
  capabilityTag?: string;
  onQueryChange: (next: string) => void;
  onToggleHighlighted: () => void;
  onToggleNonSuspicious: () => void;
  onCapabilityTagChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onToggleDir: () => void;
  onToggleView: () => void;
};

const SKILL_CAPABILITY_LABELS: Record<string, string> = {
  crypto: "Crypto",
  "requires-wallet": "Requires wallet",
  "can-make-purchases": "Payments",
  "can-sign-transactions": "Signs transactions",
  "requires-oauth-token": "OAuth",
  "posts-externally": "External posting",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "mcp-tools": <Plug size={13} />,
  prompts: <MessageSquare size={13} />,
  workflows: <GitBranch size={13} />,
  "dev-tools": <Wrench size={13} />,
  data: <Database size={13} />,
  security: <Shield size={13} />,
  automation: <Zap size={13} />,
  other: <Package size={13} />,
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
  capabilityTag,
  onQueryChange,
  onToggleHighlighted,
  onToggleNonSuspicious,
  onCapabilityTagChange,
  onSortChange,
  onToggleDir,
  onToggleView,
}: SkillsToolbarProps) {
  const activeCategory = useMemo(() => {
    if (query === "__other__") return "other";
    if (!query) return undefined;
    return SKILL_CATEGORIES.find((c) =>
      c.keywords.some((k) => k === query.trim().toLowerCase()),
    )?.slug;
  }, [query]);

  const handleCategoryChange = (cat: SkillCategory | undefined) => {
    if (!cat) {
      onQueryChange("");
    } else if (cat.slug === "other") {
      onQueryChange("__other__");
    } else if (cat.keywords[0]) {
      onQueryChange(cat.keywords[0]);
    } else {
      onQueryChange("");
    }
  };

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
        {/* Filter chips */}
        <FilterChip active={highlightedOnly} onClick={onToggleHighlighted}>
          Staff Picks
        </FilterChip>
        <FilterChip active={nonSuspiciousOnly} onClick={onToggleNonSuspicious}>
          Clean only
        </FilterChip>
        {capabilityTag ? (
          <FilterChip
            active
            onClick={() => onCapabilityTagChange("__all__")}
            icon={<X className="h-3 w-3" />}
          >
            {SKILL_CAPABILITY_LABELS[capabilityTag] ?? capabilityTag}
          </FilterChip>
        ) : null}
        <Select value={activeCategory ?? "__all__"} onValueChange={(v) => handleCategoryChange(v === "__all__" ? undefined : SKILL_CATEGORIES.find((c) => c.slug === v))}>
          <SelectTrigger
            className="w-auto min-w-[156px] min-h-[36px] py-1.5 text-xs font-semibold"
            aria-label="Filter by category"
          >
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {SKILL_CATEGORIES.map((cat) => (
              <SelectItem key={cat.slug} value={cat.slug}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="opacity-60">{CATEGORY_ICONS[cat.slug]}</span>
                  {cat.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
          variant="outline"
          size="sm"
          onClick={onToggleDir}
          aria-label={`Sort direction: ${dir === "asc" ? "ascending" : "descending"}`}
          className="min-h-[36px] px-2 rounded-[var(--radius-sm)]"
        >
          <ArrowDownUp
            className={`h-4 w-4 transition-transform ${dir === "asc" ? "rotate-180" : ""}`}
          />
        </Button>

        {/* View toggle */}
        <div className="inline-flex items-center rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] p-0.5">
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
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] px-3.5 min-h-[36px] text-xs font-semibold transition-all duration-150 ${
        active
          ? "border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
          : "text-[color:var(--ink-soft)] hover:border-[color:var(--border-ui-hover)] hover:text-[color:var(--ink)]"
      }`}
    >
      {active && !icon && <Check className="h-3 w-3" />}
      {icon && <span className={active ? "opacity-100" : "opacity-60"}>{icon}</span>}
      {children}
    </button>
  );
}
