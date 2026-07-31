import type { ActionCtx } from "../_generated/server";

type SourcePage = {
  page: unknown[];
  isDone: boolean;
  continueCursor: string;
  documentsRead: number;
};

export async function forEachCanonicalTrendingSourcePage(
  ctx: Pick<ActionCtx, "runQuery">,
  ref: unknown,
  args: Record<string, unknown>,
  visitPage: (page: unknown[]) => void | Promise<void>,
  pageSize = 250,
) {
  let cursor: string | null = null;
  let documentsRead = 0;
  let functionCalls = 0;
  do {
    const result = (await ctx.runQuery(
      ref as never,
      {
        ...args,
        paginationOpts: { cursor, numItems: pageSize },
      } as never,
    )) as SourcePage;
    await visitPage(result.page);
    documentsRead += result.documentsRead;
    functionCalls += 1;
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return { documentsRead, functionCalls };
}
