import type { PackageListItem } from "clawhub-schema";
import { compareRecommendationStats } from "./recommendationScore";

type CatalogListItem = PackageListItem & { ownerOfficial?: boolean };
type CatalogSort = "recommended" | "updated" | "downloads" | "installs" | "trending";

export type CatalogSourceCursorState = {
  cursor: string | null;
  offset: number;
  pageSize: number | null;
  done: boolean;
};

export type UnifiedCatalogCursorState = {
  packages: CatalogSourceCursorState;
  skills: CatalogSourceCursorState;
  recommendedFallback?: RecommendedFallbackSort;
  legacyInstallSort?: LegacyInstallSortMarker;
};

export type PluginCatalogCursorState = {
  codePlugins: CatalogSourceCursorState;
  bundlePlugins: CatalogSourceCursorState;
  recommendedFallback?: RecommendedFallbackSort;
  legacyInstallSort?: LegacyInstallSortMarker;
};

export type RecommendedFallbackSort = "updated" | "downloads";
type LegacyInstallSortMarker = "downloads";

export type PackagePageCursorState = {
  cursor: string | null;
  legacyInstallSort?: LegacyInstallSortMarker;
};

type CatalogPageResult<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
};

type CatalogSourceState<T> = {
  state: CatalogSourceCursorState;
  page: CatalogPageResult<T> | null;
  pageCursor: string | null;
  index: number;
};

export const PLUGIN_CATALOG_CURSOR_PREFIX = "pkgplugins:";

export function encodePluginCatalogCursor(state: PluginCatalogCursorState) {
  return `${PLUGIN_CATALOG_CURSOR_PREFIX}${JSON.stringify(state)}`;
}

export function initCatalogSource<T>(state: CatalogSourceCursorState): CatalogSourceState<T> {
  return {
    state: { ...state },
    page: null,
    pageCursor: state.cursor,
    index: state.offset,
  };
}

export function finalizeCatalogSource<T>(source: CatalogSourceState<T>): CatalogSourceCursorState {
  if (!source.page) return source.state;
  if (source.index < source.page.page.length) {
    return {
      cursor: source.pageCursor,
      offset: source.index,
      pageSize: source.state.pageSize,
      done: false,
    };
  }
  return {
    cursor: source.page.continueCursor,
    offset: 0,
    pageSize: source.state.pageSize,
    done: source.page.isDone,
  };
}

export async function ensureCatalogSourcePage<T>(
  source: CatalogSourceState<T>,
  pageSize: number,
  fetchPage: (cursor: string | null, pageSize: number) => Promise<CatalogPageResult<T>>,
) {
  while (true) {
    if (!source.page) {
      if (source.state.done && source.state.offset === 0) return null;
      const effectivePageSize = source.state.pageSize ?? pageSize;
      source.pageCursor = source.state.cursor;
      source.page = await fetchPage(source.pageCursor, effectivePageSize);
      source.state.pageSize = effectivePageSize;
      source.index = source.state.offset;
    }

    if (source.index < source.page.page.length) {
      return source.page.page[source.index];
    }

    if (source.page.isDone) return null;

    source.state.cursor = source.page.continueCursor;
    source.state.offset = 0;
    source.state.done = source.page.isDone;
    source.page = null;
    source.pageCursor = source.state.cursor;
    source.index = 0;
  }
}

export function compareCatalogItems(a: CatalogListItem, b: CatalogListItem) {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.family !== b.family) return a.family.localeCompare(b.family);
  return a.name.localeCompare(b.name);
}

export function compareCatalogItemsForSort(
  a: CatalogListItem,
  b: CatalogListItem,
  sort: CatalogSort | undefined,
) {
  if (sort === "recommended") {
    const score = compareRecommendationStats(
      {
        downloads: a.stats?.downloads ?? 0,
        installs: a.stats?.installs ?? 0,
        stars: a.stats?.stars ?? 0,
      },
      {
        downloads: b.stats?.downloads ?? 0,
        installs: b.stats?.installs ?? 0,
        stars: b.stats?.stars ?? 0,
      },
    );
    if (score !== 0) return score;
  }
  if (sort === "downloads" || sort === "installs") {
    const downloads = (b.stats?.downloads ?? 0) - (a.stats?.downloads ?? 0);
    if (downloads !== 0) return downloads;
  }
  return compareCatalogItems(a, b);
}
