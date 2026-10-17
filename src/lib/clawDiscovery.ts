import { CLAW_CATEGORY_DEFINITIONS, isClawCategorySlug } from "clawhub-schema";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";

export type ClawListing = FunctionReturnType<typeof api.packages.listPublicPage>["page"][number];
export type ClawDiscovery = { items: ClawListing[]; featured: ClawListing[] };

// The current API has no category totals. Read complete, bounded pages rather than
// silently calling a partial sample the most popular categories. A materialized
// category feed should replace this adapter before the catalog exceeds this budget.
export async function fetchClawDiscovery(): Promise<ClawDiscovery> {
  const featuredPromise = convexHttp.query(api.packages.listPublicPage, {
    family: "claw",
    highlightedOnly: true,
    paginationOpts: { cursor: null, numItems: 4 },
  });
  const itemsPromise = (async () => {
    const items = new Map<string, ClawListing>();
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const result: FunctionReturnType<typeof api.packages.listPublicPage> = await convexHttp.query(
        api.packages.listPublicPage,
        {
          family: "claw",
          sort: "downloads",
          paginationOpts: { cursor, numItems: 100 },
        },
      );
      for (const item of result.page) if (item.family === "claw") items.set(item.name, item);
      if (result.isDone) return [...items.values()];
      if (!result.continueCursor || result.continueCursor === cursor) break;
      cursor = result.continueCursor;
    }
    throw new Error("Claw discovery requires a complete category index.");
  })();
  const [items, featured] = await Promise.all([itemsPromise, featuredPromise]);
  return { items, featured: featured.page.filter((item) => item.family === "claw") };
}

export function clawCategoryLabel(slug: string) {
  return (
    CLAW_CATEGORY_DEFINITIONS.find((category) => category.slug === slug)?.label ??
    slug.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function popularClawCategories(items: ClawListing[]) {
  const groups = new Map<string, { slug: string; downloads: number; items: ClawListing[] }>();
  for (const item of items) {
    for (const slug of new Set(item.categories ?? [])) {
      if (!isClawCategorySlug(slug)) continue;
      const group = groups.get(slug) ?? { slug, downloads: 0, items: [] };
      group.downloads += item.stats.downloads;
      group.items.push(item);
      groups.set(slug, group);
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.downloads - a.downloads || a.slug.localeCompare(b.slug))
    .map((group) => ({
      ...group,
      items: group.items.sort(
        (a, b) => b.stats.downloads - a.stats.downloads || a.name.localeCompare(b.name),
      ),
    }));
}

export function filterClaws(items: ClawListing[], query: string, category?: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      (!category || item.categories?.includes(category)) &&
      terms.every((term) =>
        [item.name, item.displayName, item.summary, item.ownerHandle, ...(item.categories ?? [])]
          .join(" ")
          .toLocaleLowerCase()
          .includes(term),
      ),
  );
}
