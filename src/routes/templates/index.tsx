import { createFileRoute } from "@tanstack/react-router";
import type { TemplateCategorySlug } from "clawhub-schema/catalogMetadata";
import { PackageSearch } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PluginListItem } from "../../components/PluginListItem";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { Button } from "../../components/ui/button";
import { formatRetryDelay } from "../../lib/formatRetryDelay";
import { buildSocialMetaHead } from "../../lib/og";
import { fetchTemplateCatalog, isRateLimitedPackageApiError } from "../../lib/packageApi";
import { getClawHubSiteUrl } from "../../lib/site";
import { buildTemplateDetailHref } from "../../lib/templateRoutes";
import { TEMPLATE_DIRECTORY_SHARE } from "../../lib/templateShare";
import { useLoadMoreObserver } from "../../lib/useLoadMoreObserver";

type CatalogSearch = { q?: string; category?: TemplateCategorySlug };
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
  loaderDeps: ({ search }) => ({ q: search.q, category: search.category }),
  loader: ({ deps, abortController }) => loadCatalogPage(deps, abortController.signal),
  head: () => {
    const site = getClawHubSiteUrl();
    const { title, description, imagePath } = TEMPLATE_DIRECTORY_SHARE;
    const head = buildSocialMetaHead({
      title,
      description,
      image: site + imagePath,
      url: site + "/templates",
    });
    return { ...head, meta: [...head.meta, { name: "twitter:image:alt", content: title }] };
  },
  pendingComponent: TemplatesPending,
  component: TemplatesIndex,
});

function TemplatesPending() {
  return <BrowseResultsSkeleton showCategoryColumn={false} downloadsOnly count={12} />;
}

function TemplatesIndex() {
  const search = Route.useSearch();
  const initialPage = Route.useLoaderData();
  if ("error" in initialPage)
    return (
      <div className="empty-state">
        <PackageSearch size={22} className="empty-state-icon" aria-hidden="true" />
        <p className="empty-state-title">Unable to load templates</p>
        <p className="empty-state-body">{initialPage.error}</p>
      </div>
    );
  return (
    <TemplateResults
      key={JSON.stringify([search.q, search.category])}
      initialPage={initialPage}
      search={search}
    />
  );
}

function TemplateResults({
  initialPage,
  search: { q, category },
}: {
  initialPage: CatalogPage;
  search: CatalogSearch;
}) {
  const [more, setMore] = useState<{ initialPage: CatalogPage; page: CatalogPage }>();
  const [loadError, setLoadError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
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
      const result = await loadCatalogPage({ q, category }, controller.signal, cursor);
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
  }, [q, category, cursor, initialPage, page]);

  const sentinel = useLoadMoreObserver(Boolean(cursor) && !loading && !loadError, loadMore);

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
