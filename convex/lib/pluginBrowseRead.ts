import type { PackageListItem } from "clawhub-schema";
import {
  compareCatalogItemsForSort,
  encodePluginCatalogCursor,
  ensureCatalogSourcePage,
  finalizeCatalogSource,
  initCatalogSource,
} from "./catalogPage";

type PublicPluginBrowsePage = {
  items: PackageListItem[];
  nextCursor: string | null;
  totalCount?: number;
};

export type PublicPluginBrowseMetadata = {
  totalCount: number | null;
  recommendedFallback: "downloads" | null;
};

type PublicPluginBrowseReader = {
  readMetadata: () => Promise<PublicPluginBrowseMetadata>;
  fetchPage: (args: {
    family: "code-plugin" | "bundle-plugin";
    sort: "recommended" | "downloads";
    paginationOpts: { cursor: string | null; numItems: number };
  }) => Promise<{
    page: PackageListItem[];
    isDone: boolean;
    continueCursor: string | null;
  }>;
};

// This fixed public page accepts neither filters nor a caller-provided identity.
// Keep its cursor compatible with the HTTP API used for subsequent pages.
export async function readInitialPublicPluginPage(
  reader: PublicPluginBrowseReader,
): Promise<PublicPluginBrowsePage> {
  const metadata = await reader.readMetadata();
  const totalCount = metadata.totalCount;
  const recommendedFallback = metadata.recommendedFallback ?? undefined;
  const sort = recommendedFallback ?? "recommended";
  const initialState = { cursor: null, offset: 0, pageSize: null, done: false };
  const code = initCatalogSource<PackageListItem>(initialState);
  const bundle = initCatalogSource<PackageListItem>(initialState);
  const fetchPage = async (
    family: "code-plugin" | "bundle-plugin",
    cursor: string | null,
    numItems: number,
  ) => {
    const result = await reader.fetchPage({
      family,
      sort,
      paginationOpts: { cursor, numItems },
    });
    return { ...result, continueCursor: result.continueCursor ?? "" };
  };
  const items: PackageListItem[] = [];
  while (items.length < 25) {
    const [codeCandidate, bundleCandidate] = await Promise.all([
      ensureCatalogSourcePage(code, 25, (cursor, count) => fetchPage("code-plugin", cursor, count)),
      ensureCatalogSourcePage(bundle, 25, (cursor, count) =>
        fetchPage("bundle-plugin", cursor, count),
      ),
    ]);
    if (!codeCandidate && !bundleCandidate) break;
    if (
      !bundleCandidate ||
      (codeCandidate && compareCatalogItemsForSort(codeCandidate, bundleCandidate, sort) <= 0)
    ) {
      items.push(codeCandidate!);
      code.index += 1;
    } else {
      items.push(bundleCandidate);
      bundle.index += 1;
    }
  }
  const nextState = {
    codePlugins: finalizeCatalogSource(code),
    bundlePlugins: finalizeCatalogSource(bundle),
    recommendedFallback,
  };
  const done =
    nextState.codePlugins.done &&
    nextState.codePlugins.offset === 0 &&
    nextState.bundlePlugins.done &&
    nextState.bundlePlugins.offset === 0;
  return {
    items,
    nextCursor: done ? null : encodePluginCatalogCursor(nextState),
    ...(totalCount !== null ? { totalCount } : {}),
  };
}
