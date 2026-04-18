import {
  Database,
  GitBranch,
  MessageSquare,
  Package,
  Plug,
  RefreshCw,
  Shield,
  Wrench,
} from "lucide-react";
import type { SkillCategory } from "../lib/categories";

type FilterItem = {
  key: string;
  label: string;
  active: boolean;
};

type SortOption = {
  value: string;
  label: string;
};

type BrowseSidebarProps = {
  categories?: SkillCategory[];
  activeCategory?: string;
  onCategoryChange?: (slug: string | undefined) => void;
  sortOptions: SortOption[];
  activeSort: string;
  onSortChange: (value: string) => void;
  filters: FilterItem[];
  onFilterToggle: (key: string) => void;
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "mcp-tools": <Plug size={15} />,
  prompts: <MessageSquare size={15} />,
  workflows: <GitBranch size={15} />,
  "dev-tools": <Wrench size={15} />,
  data: <Database size={15} />,
  security: <Shield size={15} />,
  automation: <RefreshCw size={15} />,
  other: <Package size={15} />,
};

export function BrowseSidebar({
  categories,
  activeCategory,
  onCategoryChange,
  sortOptions,
  activeSort,
  onSortChange,
  filters,
  onFilterToggle,
}: BrowseSidebarProps) {
  return (
    <aside className="browse-sidebar" aria-label="Browse filters">
      <fieldset className="sidebar-section" role="radiogroup" aria-label="Sort order">
        <legend className="sidebar-title">Sort by</legend>
        {sortOptions.map((opt) => (
          <button
            key={opt.value}
            className={`sidebar-option${activeSort === opt.value ? " is-active" : ""}`}
            type="button"
            role="radio"
            aria-checked={activeSort === opt.value}
            onClick={() => onSortChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </fieldset>

      {categories && onCategoryChange ? (
        <fieldset className="sidebar-section" role="radiogroup" aria-label="Category filter">
          <legend className="sidebar-title">Categories</legend>
          <button
            className={`sidebar-option${!activeCategory ? " is-active" : ""}`}
            type="button"
            role="radio"
            aria-checked={!activeCategory}
            onClick={() => onCategoryChange(undefined)}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.slug}
              className={`sidebar-option${activeCategory === cat.slug ? " is-active" : ""}`}
              type="button"
              role="radio"
              aria-checked={activeCategory === cat.slug}
              onClick={() => onCategoryChange(cat.slug)}
            >
              <span className="sidebar-option-icon" aria-hidden="true">
                {CATEGORY_ICONS[cat.slug]}
              </span>
              {cat.label}
            </button>
          ))}
        </fieldset>
      ) : null}

      <fieldset className="sidebar-section" aria-label="Toggle filters">
        <legend className="sidebar-title">Filters</legend>
        {filters.map((f) => (
          <label key={f.key} className="sidebar-checkbox">
            <input
              type="checkbox"
              checked={f.active}
              onChange={() => onFilterToggle(f.key)}
              aria-label={f.label}
            />
            <span>{f.label}</span>
          </label>
        ))}
      </fieldset>
    </aside>
  );
}
