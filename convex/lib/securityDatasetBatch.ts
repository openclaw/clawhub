import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { ArtifactExportPage } from "../securityDataset";

export const MAX_EXPORT_BATCH_PAGES = 20;

export type ArtifactExportBatchArgs = {
  sourceKind: "skill" | "package";
  mode?: "public";
  createdAtGte?: number;
  createdAtLt?: number;
  paginationOpts: {
    cursor: string | null;
    numItems: number;
  };
  pageCount: number;
};

type ArtifactExportBatch = Omit<ArtifactExportPage, "continueCursor"> & {
  continueCursor: string | null;
};

export async function collectArtifactExportBatch(
  ctx: Pick<ActionCtx, "runQuery">,
  args: ArtifactExportBatchArgs,
): Promise<ArtifactExportBatch> {
  const pageCount = Math.min(Math.max(1, Math.floor(args.pageCount)), MAX_EXPORT_BATCH_PAGES);
  let cursor = args.paginationOpts.cursor;
  const page: ArtifactExportPage["page"] = [];
  let isDone = false;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const result: ArtifactExportPage = await ctx.runQuery(
      internal.securityDataset.listArtifactExportPageInternal,
      {
        sourceKind: args.sourceKind,
        mode: args.mode,
        createdAtGte: args.createdAtGte,
        createdAtLt: args.createdAtLt,
        paginationOpts: {
          cursor,
          numItems: args.paginationOpts.numItems,
        },
      },
    );
    page.push(...result.page);
    cursor = result.continueCursor;
    isDone = result.isDone;
    if (isDone) break;
  }
  return { page, isDone, continueCursor: cursor, exportMode: args.mode ?? "public" };
}
