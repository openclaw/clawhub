import {
  Activity,
  BookOpen,
  Brain,
  Database,
  FolderCog,
  GitBranch,
  Globe,
  GraduationCap,
  ListChecks,
  MessageCircle,
  MessageSquare,
  Package,
  Palette,
  Plug,
  RefreshCw,
  Rocket,
  Shapes,
  Shield,
  WalletCards,
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
  categoryTopics?: string[];
  activeTopic?: string;
  onTopicChange?: (topic: string | undefined) => void;
  sortOptions?: SortOption[];
  activeSort?: string;
  onSortChange?: (value: string) => void;
  radioGroups?: RadioGroup[];
  filters?: FilterItem[];
  onFilterToggle?: (key: string) => void;
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  activity: <Activity size={15} />,
  "book-open": <BookOpen size={15} />,
  brain: <Brain size={15} />,
  database: <Database size={15} />,
  "folder-cog": <FolderCog size={15} />,
  "git-branch": <GitBranch size={15} />,
  globe: <Globe size={15} />,
  "graduation-cap": <GraduationCap size={15} />,
  "list-checks": <ListChecks size={15} />,
  "message-circle": <MessageCircle size={15} />,
  "message-square": <MessageSquare size={15} />,
  package: <Package size={15} />,
  palette: <Palette size={15} />,
  plug: <Plug size={15} />,
  "refresh-cw": <RefreshCw size={15} />,
  rocket: <Rocket size={15} />,
  shield: <Shield size={15} />,
  shapes: <Shapes size={15} />,
  "wallet-cards": <WalletCards size={15} />,
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
  categoryTopics = [],
  activeTopic,
  onTopicChange,
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
          {categories.map((cat) => {
            const isActive = activeCategory === cat.slug;
            return (
              <div key={cat.slug} className="sidebar-category">
                <button
                  className={`sidebar-option${isActive ? " is-active" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => onCategoryChange(cat.slug)}
                >
                  <span className="sidebar-option-icon" aria-hidden="true">
                    {getCategoryIcon(cat.icon)}
                  </span>
                  {cat.label}
                </button>
                {isActive && categoryTopics.length > 0 && onTopicChange ? (
                  <div className="sidebar-category-topics" aria-label={`${cat.label} top topics`}>
                    {categoryTopics.slice(0, 5).map((topic) => {
                      const isActiveTopic = activeTopic === topic;
                      return (
                        <button
                          key={topic}
                          className={`sidebar-topic-chip${isActiveTopic ? " is-active" : ""}`}
                          type="button"
                          aria-pressed={isActiveTopic}
                          onClick={() => onTopicChange(isActiveTopic ? undefined : topic)}
                        >
                          #{topic}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ) : null}

      {filterSection}
    </aside>
  );
}
