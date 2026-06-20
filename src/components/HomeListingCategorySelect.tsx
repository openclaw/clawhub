import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BrowseCategoryIcon } from "../lib/browseCategoryIcons";
import type { BrowseCategory } from "../lib/categories";

type HomeListingCategorySelectProps = {
  categories: readonly BrowseCategory[];
  value: readonly string[];
  onChange: (slugs: string[]) => void;
};

function CategoryOption({
  slug,
  label,
  icon,
  selected,
  onSelect,
  reset = false,
}: {
  slug: string | null;
  label: string;
  icon?: string | null;
  selected: boolean;
  onSelect: () => void;
  reset?: boolean;
}) {
  return (
    <li
      className={`home-v2-listing-category-option-wrap${reset ? " is-reset" : ""}`}
      role="presentation"
    >
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className={`home-v2-listing-category-option${selected ? " is-selected" : ""}`}
        onClick={onSelect}
      >
        <span className="home-v2-listing-category-option-mark" aria-hidden="true">
          {selected ? <Check size={12} strokeWidth={2.5} /> : null}
        </span>
        <BrowseCategoryIcon
          slug={slug}
          icon={icon}
          size={16}
          className="home-v2-listing-category-option-icon"
        />
        <span className="home-v2-listing-category-option-label">{label}</span>
      </button>
    </li>
  );
}

export function HomeListingCategorySelect({
  categories,
  value,
  onChange,
}: HomeListingCategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedLabel = useMemo(() => {
    if (value.length === 0) return "All categories";
    if (value.length === 1) {
      return categories.find((category) => category.slug === value[0])?.label ?? "All categories";
    }
    return `${value.length} categories`;
  }, [categories, value]);
  const selectedCategory = useMemo(
    () => (value.length === 1 ? categories.find((category) => category.slug === value[0]) : null),
    [categories, value],
  );

  const selectedSet = useMemo(() => new Set(value), [value]);

  const filteredCategories = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return categories;
    return categories.filter(
      (category) =>
        category.label.toLowerCase().includes(normalized) || category.slug.includes(normalized),
    );
  }, [categories, query]);

  const closeMenu = () => {
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
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

  const pick = (slug: string | null) => {
    if (slug === null) {
      onChange([]);
      return;
    }
    if (selectedSet.has(slug)) {
      onChange(value.filter((selectedSlug) => selectedSlug !== slug));
      return;
    }
    onChange([...value, slug]);
  };

  return (
    <div className="home-v2-listing-category-menu home-v2-listing-category-select" ref={rootRef}>
      <button
        type="button"
        className="home-v2-listing-category-trigger"
        role="combobox"
        aria-label="Category"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="home-v2-listing-category-trigger-main">
          <BrowseCategoryIcon
            slug={selectedCategory?.slug ?? null}
            icon={selectedCategory?.icon}
            size={15}
            className="home-v2-listing-category-trigger-category-icon"
          />
          <span className="home-v2-listing-category-trigger-label">{selectedLabel}</span>
        </span>
        <ChevronDown
          size={16}
          className={`home-v2-listing-category-trigger-icon${open ? " is-open" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="home-v2-listing-category-panel">
          <div className="home-v2-listing-category-search-wrap">
            <Search size={16} className="home-v2-listing-category-search-icon" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              className="home-v2-listing-category-search"
              placeholder="Search categories…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search categories"
              autoComplete="off"
            />
          </div>
          <ul
            id={listboxId}
            className="home-v2-listing-category-options"
            role="listbox"
            aria-multiselectable="true"
            aria-label="Category"
          >
            {!query.trim() ? (
              <CategoryOption
                slug={null}
                label="All categories"
                selected={value.length === 0}
                onSelect={() => pick(null)}
                reset
              />
            ) : null}
            {filteredCategories.map((category) => (
              <CategoryOption
                key={category.slug}
                slug={category.slug}
                label={category.label}
                icon={category.icon}
                selected={selectedSet.has(category.slug)}
                onSelect={() => pick(category.slug)}
              />
            ))}
            {filteredCategories.length === 0 ? (
              <li className="home-v2-listing-category-empty" role="presentation">
                No categories match
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
