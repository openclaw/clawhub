import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BrowseCategoryIcon } from "../lib/browseCategoryIcons";
import { BROWSE_TAXONOMY } from "../lib/browseTaxonomy";

type HomeListingCategorySelectProps = {
  value: string | null;
  onChange: (slug: string | null) => void;
};

function CategoryOption({
  slug,
  label,
  selected,
  onSelect,
}: {
  slug: string | null;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="home-v2-listing-category-option-wrap" role="presentation">
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
          size={16}
          className="home-v2-listing-category-option-icon"
        />
        <span className="home-v2-listing-category-option-label">{label}</span>
      </button>
    </li>
  );
}

export function HomeListingCategorySelect({ value, onChange }: HomeListingCategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedLabel = useMemo(() => {
    if (!value) return "All categories";
    return BROWSE_TAXONOMY.find((category) => category.slug === value)?.label ?? "All categories";
  }, [value]);

  const filteredCategories = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return BROWSE_TAXONOMY;
    return BROWSE_TAXONOMY.filter(
      (category) =>
        category.label.toLowerCase().includes(normalized) ||
        category.slug.includes(normalized),
    );
  }, [query]);

  const closeMenu = () => {
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return;
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
    onChange(slug);
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
            slug={value}
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
            aria-label="Category"
          >
            {!query.trim() ? (
              <CategoryOption
                slug={null}
                label="All categories"
                selected={value === null}
                onSelect={() => pick(null)}
              />
            ) : null}
            {filteredCategories.map((category) => (
              <CategoryOption
                key={category.slug}
                slug={category.slug}
                label={category.label}
                selected={value === category.slug}
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
