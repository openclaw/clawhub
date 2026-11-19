import { createFileRoute } from "@tanstack/react-router";
import {
  isTemplateCategorySlug,
  TEMPLATE_CATEGORY_DEFINITIONS,
} from "clawhub-schema/catalogMetadata";
import { PackageSearch } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowseCategorySelect,
  BrowseCategorySidebar,
  BrowseControls,
  BrowseSearchInput,
} from "../../components/BrowseControls";
import { PluginListItem } from "../../components/PluginListItem";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { Button } from "../../components/ui/button";
import { formatRetryDelay } from "../../lib/formatRetryDelay";
import { fetchTemplateCatalog, isRateLimitedPackageApiError } from "../../lib/packageApi";
import { buildTemplateDetailHref } from "../../lib/templateRoutes";

function parseCategory(value: unknown) {
  return typeof value === "string" && isTemplateCategorySlug(value) ? value : undefined;
}

type CatalogSearch = { q?: string; category?: ReturnType<typeof parseCategory> };
type CatalogPage = Awaited<ReturnType<typeof fetchTemplateCatalog>>;
type CatalogResult = CatalogPage | { error: string };

async function loadCatalogPage(
  search: CatalogSearch,
  signal: AbortSignal,
  cursor?: string,
): Promise<CatalogResult> {
  try {
    return await fetchTemplateCatalog({
      ...search,
      cursor,
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      error: isRateLimitedPackageApiError(error)
        ? `Try again ${formatRetryDelay(error.retryAfterSeconds)}.`
        : "The Template catalog is temporarily unavailable. Please try again later.",
    };
  }
}

export const Route = createFileRoute("/templates/")({
  validateSearch: (search): CatalogSearch => ({
    q: typeof search.q === "string" ? search.q.trim() || undefined : undefined,
    category: parseCategory(search.category),
  }),
  loaderDeps: ({ search }) => ({ q: search.q, category: search.category }),
  loader: ({ deps, abortController }) => loadCatalogPage(deps, abortController.signal),
  head: () => ({ meta: [{ title: "Templates - ClawHub" }] }),
  pendingComponent: TemplatesPending,
  component: TemplatesIndex,
});

function TemplatesPending() {
  return (
    <main className="browse-page browse-page-borderless-header plugins-browse-page catalog-browse-page">
      <div className="browse-page-header">
        <h1 className="browse-title">Templates</h1>
      </div>
      <BrowseResultsSkeleton label="Template" showCategoryColumn={false} />
    </main>
  );
}

function TemplatesIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const initialPage = Route.useLoaderData() as CatalogResult | undefined;
  const [query, setQuery] = useState(search.q ?? "");
  const timer = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setQuery(search.q ?? ""), [search.q]);
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
    <main className="browse-page browse-page-borderless-header plugins-browse-page catalog-browse-page">
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
          {!initialPage ? (
            <BrowseResultsSkeleton label="Template" showCategoryColumn={false} />
          ) : "error" in initialPage ? (
            <div className="empty-state">
              <PackageSearch size={22} className="empty-state-icon" aria-hidden="true" />
              <p className="empty-state-title">Unable to load templates</p>
              <p className="empty-state-body">{initialPage.error}</p>
            </div>
          ) : (
            <TemplateResults
              key={JSON.stringify([search.q, search.category])}
              initialPage={initialPage}
              category={search.category}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function TemplateResults({
  initialPage,
  category,
}: {
  initialPage: CatalogPage;
  category: CatalogSearch["category"];
}) {
  const [more, setMore] = useState<{ initialPage: CatalogPage; page: CatalogPage }>();
  const [loadError, setLoadError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const page = more?.initialPage === initialPage ? more.page : initialPage;
  const cursor = page.nextCursor;

  useEffect(() => {
    setLoading(false);
    setLoadError(undefined);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [initialPage]);

  const loadMore = useCallback(async () => {
    if (!cursor || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setLoadError(undefined);
    try {
      const result = await loadCatalogPage({ category }, controller.signal, cursor);
      if (controller.signal.aborted) return;
      if ("error" in result) {
        setLoadError(result.error);
      } else {
        setMore({
          initialPage,
          page: { items: [...page.items, ...result.items], nextCursor: result.nextCursor },
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [category, cursor, initialPage, page]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !cursor || loading || loadError || typeof IntersectionObserver === "undefined")
      return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, loading, loadError, loadMore]);

  const rows = page.items.flatMap((item) => {
    const href = buildTemplateDetailHref(item.name, item.ownerHandle);
    return href
      ? [<PluginListItem key={item.name} item={item} itemKind="template" href={href} />]
      : [];
  });
  return (
    <>
      {rows.length ? (
        <div className="browse-list-stack">
          <div className="browse-list-head browse-list-head-simple" aria-hidden="true">
            <span className="browse-list-head-icon-spacer" />
            <span className="browse-list-head-label">Template</span>
            <span className="browse-list-head-label browse-list-head-stat">Downloads</span>
          </div>
          <div className="results-list">{rows}</div>
        </div>
      ) : (
        <div className="empty-state">
          <p className="empty-state-title">No templates found</p>
          <p className="empty-state-body">Try a different search term or remove filters.</p>
        </div>
      )}
      {cursor ? (
        <div ref={sentinel} className="mt-5 flex flex-col items-center gap-2">
          {loadError ? <p role="status">{loadError}</p> : null}
          <Button variant="primary" type="button" onClick={loadMore} disabled={loading}>
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
