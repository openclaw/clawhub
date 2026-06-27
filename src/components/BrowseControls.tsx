import { Check, ChevronDown, LayoutGrid, List, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { BrowseCategoryIcon } from "../lib/browseCategoryIcons";
import type { BrowseCategory } from "../lib/categories";

type BrowseChoice = {
  value: string | undefined;
  label: string;
  mobileLabel?: string;
  count?: string;
  icon?: ReactNode;
};

type BrowseControlsProps = {
  children: ReactNode;
};

export function BrowseControls({ children }: BrowseControlsProps) {
  return <div className="browse-controls">{children}</div>;
}

type BrowseControlsRowProps = {
  children: ReactNode;
};

export function BrowseControlsRow({ children }: BrowseControlsRowProps) {
  return <div className="browse-controls-row">{children}</div>;
}

export function BrowseControlsDivider() {
  return <span className="browse-controls-divider" aria-hidden="true" />;
}

type BrowseTabsProps = {
  ariaLabel: string;
  options: readonly BrowseChoice[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

export function BrowseTabs({ ariaLabel, options, value, onChange }: BrowseTabsProps) {
  return (
    <div className="browse-tabs" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value ?? "all"}
            className={`browse-tab${active ? " is-active" : ""}`}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.mobileLabel ? option.label : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.mobileLabel ? (
              <>
                <span className="lg:hidden" aria-hidden="true">
                  {option.mobileLabel}
                </span>
                <span className="hidden lg:inline" aria-hidden="true">
                  {option.label}
                </span>
              </>
            ) : (
              option.label
            )}
          </button>
        );
      })}
    </div>
  );
}

export function BrowseChipTabs({ ariaLabel, options, value, onChange }: BrowseTabsProps) {
  return (
    <div className="browse-chip-tabs" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value ?? "all"}
            className={`browse-chip-tab${active ? " is-active" : ""}`}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.count != null ? `${option.label} ${option.count}` : option.label}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            <span className="browse-chip-tab-label">{option.label}</span>
            {option.count != null ? (
              <span className="browse-chip-tab-count" aria-hidden="true">
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function BrowseSegmentedTabs({ ariaLabel, options, value, onChange }: BrowseTabsProps) {
  return (
    <div className="clawhub-segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value ?? "all"}
            type="button"
            className={`clawhub-segmented-btn${active ? " is-active" : ""}`}
            aria-pressed={active}
            aria-label={option.count != null ? `${option.label} ${option.count}` : option.label}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            <span className="clawhub-segmented-label">{option.label}</span>
            {option.count != null ? (
              <span className="clawhub-segmented-count" aria-hidden="true">
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

type BrowseSortSelectProps = {
  options: readonly BrowseChoice[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

export function BrowseSortSelect({ options, value, onChange }: BrowseSortSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const pick = (nextValue: string | undefined) => {
    onChange(nextValue);
    close();
  };

  return (
    <div className="browse-sort-select" ref={rootRef}>
      <button
        type="button"
        className="browse-sort-trigger"
        role="combobox"
        aria-label="Sort"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="browse-sort-label">{selected?.label ?? "Sort"}</span>
        <ChevronDown
          size={16}
          className={`browse-sort-chevron${open ? " is-open" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="browse-sort-panel">
          <ul id={listboxId} className="browse-sort-options" role="listbox" aria-label="Sort">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <li key={option.value} className="browse-sort-option-wrap" role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`browse-sort-option${active ? " is-selected" : ""}`}
                    onClick={() => pick(option.value)}
                  >
                    {option.icon}
                    <span className="browse-sort-option-label">{option.label}</span>
                    <span className="browse-sort-option-mark" aria-hidden="true">
                      {active ? <Check size={14} strokeWidth={2.4} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type BrowseActionsProps = {
  children: ReactNode;
};

export function BrowseActions({ children }: BrowseActionsProps) {
  return <div className="browse-actions">{children}</div>;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

type BrowseSearchDisclosureOptions = {
  value: string;
  onClear: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function useBrowseSearchDisclosure({
  value,
  onClear,
  inputRef,
}: BrowseSearchDisclosureOptions) {
  const [open, setOpen] = useState(Boolean(value.trim()));

  const openSearch = useCallback(() => {
    setOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputRef]);

  const closeSearch = useCallback(() => {
    setOpen(false);
    onClear();
    inputRef.current?.blur();
  }, [inputRef, onClear]);

  useEffect(() => {
    if (value.trim()) setOpen(true);
  }, [value]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      event.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (value.trim()) {
        onClear();
        return;
      }
      setOpen(false);
      inputRef.current?.blur();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inputRef, onClear, open, value]);

  return { open, openSearch, closeSearch };
}

type BrowseSearchTriggerProps = {
  open: boolean;
  onOpen: () => void;
  label: string;
  disabled?: boolean;
};

export function BrowseSearchTrigger({ open, onOpen, label, disabled }: BrowseSearchTriggerProps) {
  return (
    <button
      type="button"
      className={`browse-search-trigger${open ? " is-active" : ""}`}
      aria-label={label}
      aria-expanded={open}
      title={`${label} (/)`}
      onClick={onOpen}
      disabled={disabled}
    >
      <Search size={17} aria-hidden="true" />
    </button>
  );
}

type BrowseSearchPanelProps = {
  open: boolean;
  children: ReactNode;
};

export function BrowseSearchPanel({ open, children }: BrowseSearchPanelProps) {
  return (
    <div className={`browse-search-panel${open ? " is-open" : ""}`} hidden={!open}>
      {children}
    </div>
  );
}

type BrowseSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onSubmit?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  label: string;
  placeholder: string;
  closeLabel?: string;
};

export function BrowseSearchInput({
  value,
  onChange,
  onClear,
  onSubmit,
  inputRef,
  label,
  placeholder,
  closeLabel,
}: BrowseSearchInputProps) {
  const content = (
    <>
      <Search size={16} className="browse-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        className="browse-search-input"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
      />
      {value || closeLabel ? (
        <button
          type="button"
          className="browse-search-clear"
          aria-label={closeLabel ?? `Clear ${label}`}
          onClick={onClear}
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </>
  );

  if (!onSubmit) {
    return <div className="browse-search-control">{content}</div>;
  }

  return (
    <form
      className="browse-search-control"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {content}
    </form>
  );
}

type BrowseCategorySelectProps = {
  categories: readonly BrowseCategory[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

export function BrowseCategorySelect({ categories, value, onChange }: BrowseCategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const selected = useMemo(
    () => categories.find((category) => category.slug === value),
    [categories, value],
  );
  const filteredCategories = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return categories;
    return categories.filter(
      (category) =>
        category.label.toLowerCase().includes(normalized) || category.slug.includes(normalized),
    );
  }, [categories, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const pick = (slug: string | undefined) => {
    onChange(slug);
    close();
  };

  return (
    <div className="browse-category-select" ref={rootRef}>
      <button
        type="button"
        className="browse-category-trigger"
        role="combobox"
        aria-label="Category"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="browse-category-trigger-main">
          <BrowseCategoryIcon
            slug={selected?.slug ?? null}
            icon={selected?.icon}
            size={16}
            className="browse-category-icon"
          />
          <span className="browse-category-label">{selected?.label ?? "All categories"}</span>
        </span>
        <ChevronDown
          size={16}
          className={`browse-category-chevron${open ? " is-open" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="browse-category-panel">
          <div className="browse-category-search-wrap">
            <Search size={16} className="browse-category-search-icon" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              className="browse-category-search"
              placeholder="Search categories…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search categories"
              autoComplete="off"
            />
          </div>
          <ul
            id={listboxId}
            className="browse-category-options"
            role="radiogroup"
            aria-label="Category"
          >
            {!query.trim() ? (
              <li className="browse-category-option-wrap is-reset" role="presentation">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!value}
                  className={`browse-category-option${!value ? " is-selected" : ""}`}
                  onClick={() => pick(undefined)}
                >
                  <span className="browse-category-option-mark" aria-hidden="true">
                    {!value ? <span className="browse-category-option-dot" /> : null}
                  </span>
                  <BrowseCategoryIcon
                    slug={null}
                    size={16}
                    className="browse-category-option-icon"
                  />
                  <span className="browse-category-option-label">All categories</span>
                </button>
              </li>
            ) : null}
            {filteredCategories.map((category) => {
              const active = category.slug === value;
              return (
                <li key={category.slug} className="browse-category-option-wrap" role="presentation">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`browse-category-option${active ? " is-selected" : ""}`}
                    onClick={() => pick(category.slug)}
                  >
                    <span className="browse-category-option-mark" aria-hidden="true">
                      {active ? <span className="browse-category-option-dot" /> : null}
                    </span>
                    <BrowseCategoryIcon
                      slug={category.slug}
                      icon={category.icon}
                      size={16}
                      className="browse-category-option-icon"
                    />
                    <span className="browse-category-option-label">{category.label}</span>
                  </button>
                </li>
              );
            })}
            {filteredCategories.length === 0 ? (
              <li className="browse-category-empty" role="presentation">
                No categories match
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type BrowseTopicChipsProps = {
  topics: readonly string[];
  activeTopic?: string;
  onChange: (topic: string | undefined) => void;
};

export function BrowseTopicChips({ topics, activeTopic, onChange }: BrowseTopicChipsProps) {
  const displayTopics = useMemo(() => {
    const safeTopics = Array.isArray(topics) ? topics.filter(Boolean) : [];
    if (!activeTopic || safeTopics.includes(activeTopic)) return safeTopics;
    return [activeTopic, ...safeTopics];
  }, [activeTopic, topics]);

  if (displayTopics.length === 0) return null;

  const ariaLabel =
    displayTopics.length === 1 && activeTopic ? "Active topic filter" : "Top topics";

  return (
    <div className="browse-topic-chips" aria-label={ariaLabel}>
      {displayTopics.slice(0, 8).map((topic) => {
        const active = activeTopic === topic;
        if (active) {
          return (
            <span
              key={topic}
              className="browse-topic-chip is-active"
              role="group"
              aria-label={`Topic filter ${topic}`}
            >
              <span className="browse-topic-chip-label">#{topic}</span>
              <button
                type="button"
                className="browse-topic-chip-clear"
                aria-label={`Clear topic ${topic}`}
                onClick={() => onChange(undefined)}
              >
                <X size={12} strokeWidth={2.25} aria-hidden="true" />
              </button>
            </span>
          );
        }

        return (
          <button
            key={topic}
            type="button"
            className="browse-topic-chip"
            aria-pressed={false}
            onClick={() => onChange(topic)}
          >
            #{topic}
          </button>
        );
      })}
    </div>
  );
}

type BrowseViewToggleProps = {
  view: "list" | "grid";
  onToggle: () => void;
};

export function BrowseViewToggle({ view, onToggle }: BrowseViewToggleProps) {
  return (
    <div className="clawhub-segmented browse-view-toggle" role="group" aria-label="Layout">
      <button
        className={`clawhub-segmented-btn home-v2-listing-view-btn browse-view-btn${view === "list" ? " is-active" : ""}`}
        type="button"
        aria-label="List"
        aria-pressed={view === "list"}
        onClick={view === "grid" ? onToggle : undefined}
      >
        <List size={16} aria-hidden="true" />
      </button>
      <button
        className={`clawhub-segmented-btn home-v2-listing-view-btn browse-view-btn${view === "grid" ? " is-active" : ""}`}
        type="button"
        aria-label="Grid"
        aria-pressed={view === "grid"}
        onClick={view === "list" ? onToggle : undefined}
      >
        <LayoutGrid size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
