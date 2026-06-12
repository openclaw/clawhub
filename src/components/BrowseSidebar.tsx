import {
  Activity,
  Database,
  GitBranch,
  MessageCircle,
  MessageSquare,
  Package,
  Plug,
  RefreshCw,
  Rocket,
  Shield,
  Wrench,
  Zap,
} from "lucide-react";
import type { BrowseCategory } from "../lib/categories";

type FilterItem = {
  key: string;
  label: string;
  active: boolean;
};

type SortOption = {
  value: string;
  label: string;
};

type RadioGroupOption = {
  value: string | undefined;
  label: string;
};

type RadioGroup = {
  title: string;
  ariaLabel: string;
  options: RadioGroupOption[];
  activeValue: string | undefined;
  onChange: (value: string | undefined) => void;
};

type BrowseSidebarProps = {
  categories?: BrowseCategory[];
  activeCategory?: string;
  onCategoryChange?: (slug: string | undefined) => void;
  sortOptions?: SortOption[];
  activeSort?: string;
  onSortChange?: (value: string) => void;
  radioGroups?: RadioGroup[];
  filters?: FilterItem[];
  onFilterToggle?: (key: string) => void;
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  activity: <Activity size={15} />,
  database: <Database size={15} />,
  "git-branch": <GitBranch size={15} />,
  "message-circle": <MessageCircle size={15} />,
  "message-square": <MessageSquare size={15} />,
  package: <Package size={15} />,
  plug: <Plug size={15} />,
  "refresh-cw": <RefreshCw size={15} />,
  rocket: <Rocket size={15} />,
  shield: <Shield size={15} />,
  wrench: <Wrench size={15} />,
  zap: <Zap size={15} />,
};

function getCategoryIcon(icon: string) {
  return CATEGORY_ICONS[icon] ?? CATEGORY_ICONS.package;
}

export function BrowseSidebar({
  categories,
  activeCategory,
  onCategoryChange,
  sortOptions,
  activeSort,
  onSortChange,
  radioGroups = [],
  filters = [],
  onFilterToggle,
}: BrowseSidebarProps) {
  const filterSection =
    filters.length && onFilterToggle ? (
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
    ) : null;

  return (
    <aside className="browse-sidebar" aria-label="Browse filters">
      {sortOptions?.length && activeSort && onSortChange ? (
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
      ) : null}

      {radioGroups.map((group) => (
        <fieldset
          key={group.title}
          className="sidebar-section"
          role="radiogroup"
          aria-label={group.ariaLabel}
        >
          <legend className="sidebar-title">{group.title}</legend>
          {group.options.map((opt) => (
            <button
              key={opt.value ?? "all"}
              className={`sidebar-option${group.activeValue === opt.value ? " is-active" : ""}`}
              type="button"
              role="radio"
              aria-checked={group.activeValue === opt.value}
              onClick={() => group.onChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </fieldset>
      ))}

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
                {getCategoryIcon(cat.icon)}
              </span>
              {cat.label}
            </button>
          ))}
        </fieldset>
      ) : null}

      {filterSection}
    </aside>
  );
}
