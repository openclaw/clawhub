import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  canViewerReadPackage,
  packageMatchesListFilters,
  type PackageListScanStatus,
  type PublicPackageListPage,
  toPublicPackageListItemFromPackage,
} from "./packageCatalogRead";
import { encodePublicPageCursor } from "./packagePageCursor";
import { hasMissingPackageRecommendedScore } from "./packageRecommendationRead";

type InitialPluginFamilyArgs = {
  family: "code-plugin" | "bundle-plugin";
  sort: "recommended" | "downloads";
  paginationOpts: { cursor: null; numItems: number };
};

export function canReadInitialPluginFamilyPage(args: {
  family?: Doc<"packages">["family"];
  families?: Doc<"packages">["family"][];
  channel?: string;
  isOfficial?: boolean;
  highlightedOnly?: boolean;
  category?: string;
  topic?: string;
  officialFirst?: boolean;
  excludedScanStatuses?: PackageListScanStatus[];
  viewerUserId?: Id<"users">;
  sort?: string;
  paginationOpts: { cursor: string | null; numItems: number };
}): args is InitialPluginFamilyArgs {
  return (
    (args.family === "code-plugin" || args.family === "bundle-plugin") &&
    (args.sort === "recommended" || args.sort === "downloads") &&
    args.paginationOpts.cursor === null &&
    args.paginationOpts.numItems === 25 &&
    args.families === undefined &&
    args.channel === undefined &&
    args.isOfficial === undefined &&
    args.highlightedOnly === undefined &&
    args.category === undefined &&
    args.topic === undefined &&
    args.officialFirst === undefined &&
    args.excludedScanStatuses === undefined &&
    args.viewerUserId === undefined
  );
}

// Share the default first-page read without initializing package publication code.
// Other page shapes, including the missing-score digest fallback, keep the full reader.
export async function readInitialPluginFamilyPage(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: InitialPluginFamilyArgs,
): Promise<PublicPackageListPage | null> {
  if (args.sort === "recommended" && (await hasMissingPackageRecommendedScore(ctx, args.family))) {
    return null;
  }
  const indexName =
    args.sort === "recommended"
      ? "by_active_family_recommended_score"
      : "by_active_family_downloads";
  // Preserve the existing scan window and native cursor for HTTP continuation.
  const scanPageSize = 125;
  const result = await ctx.db
    .query("packages")
    .withIndex(indexName, (q) => q.eq("softDeletedAt", undefined).eq("family", args.family))
    .order("desc")
    .paginate({ cursor: null, numItems: scanPageSize });
  const page: PublicPackageListPage["page"] = [];
  for (let index = 0; index < result.page.length; index += 1) {
    const pkg = result.page[index];
    if (!(await canViewerReadPackage(ctx, pkg, undefined))) continue;
    if (!packageMatchesListFilters(pkg, args)) continue;
    page.push(await toPublicPackageListItemFromPackage(ctx, pkg));
    if (page.length === 25) {
      const nextOffset = index + 1;
      const nextState = {
        cursor: nextOffset < result.page.length ? null : result.continueCursor,
        offset: nextOffset < result.page.length ? nextOffset : 0,
        pageSize: scanPageSize,
        done: result.isDone,
        mode: "packages" as const,
      };
      return {
        page,
        isDone: nextState.done && nextState.offset === 0,
        continueCursor: encodePublicPageCursor(nextState),
      };
    }
  }
  return {
    page,
    isDone: result.isDone,
    continueCursor: encodePublicPageCursor({
      cursor: result.continueCursor,
      offset: 0,
      pageSize: scanPageSize,
      done: result.isDone,
      mode: "packages",
    }),
  };
}
