import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import {
  isTemplateCategorySlug,
  TEMPLATE_CATEGORY_DEFINITIONS,
} from "clawhub-schema/catalogMetadata";
import { useEffect, useRef, useState } from "react";
import {
  BrowseCategorySelect,
  BrowseCategorySidebar,
  BrowseControls,
  BrowseSearchInput,
} from "../../components/BrowseControls";

function parseQuery(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCategory(value: unknown) {
  return typeof value === "string" && isTemplateCategorySlug(value) ? value : undefined;
}

type CatalogSearch = { q?: string; category?: ReturnType<typeof parseCategory> };

export const Route = createFileRoute("/templates")({
  validateSearch: (search): CatalogSearch => ({
    q: parseQuery(search.q) || undefined,
    category: parseCategory(search.category),
  }),
  component: TemplateCatalogLayout,
});

function TemplateCatalogLayout() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Sync from the requested URL, not a matched route whose loader may finish after another keystroke.
  const requested = useLocation({
    select: (location) => ({
      index: location.state.__TSR_index,
      href: location.href,
      q: parseQuery(location.search.q),
    }),
    structuralSharing: true,
  });
  const [query, setQuery] = useState(requested.q);
  const timer = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Back can restore even the same URL at a different history index. Cancel its superseded
    // debounce, but keep word separators when the requested query acknowledges the raw draft.
    window.clearTimeout(timer.current);
    setQuery((draft) => (draft.trim() === requested.q ? draft : requested.q));
  }, [requested]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const submit = (value: string, replace: boolean) => {
    window.clearTimeout(timer.current);
    void navigate({ search: (prev) => ({ ...prev, q: value.trim() || undefined }), replace });
  };
  const changeCategory = (value: string | undefined) => {
    window.clearTimeout(timer.current);
    void navigate({ search: { category: parseCategory(value), q: query.trim() || undefined } });
  };

  return (
    <main className="browse-page browse-page-borderless-header templates-browse-page catalog-browse-page">
      <div className="browse-page-header">
        <h1 className="browse-title">Templates</h1>
      </div>
      <BrowseControls>
        <BrowseSearchInput
          inputRef={inputRef}
          focusShortcut
          label="Template search"
          placeholder="Search templates..."
          value={query}
          onChange={(value) => {
            setQuery(value);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => submit(value, true), 250);
          }}
          onClear={() => {
            setQuery("");
            inputRef.current?.focus();
            submit("", true);
          }}
          onSubmit={() => submit(query, false)}
        />
        <BrowseCategorySelect
          categories={TEMPLATE_CATEGORY_DEFINITIONS}
          value={search.category}
          onChange={changeCategory}
          responsive
        />
      </BrowseControls>
      <div className="browse-layout browse-layout-with-sidebar">
        <BrowseCategorySidebar
          ariaLabel="Template categories"
          categories={TEMPLATE_CATEGORY_DEFINITIONS}
          value={search.category}
          onChange={changeCategory}
        />
        <div className="browse-results">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
