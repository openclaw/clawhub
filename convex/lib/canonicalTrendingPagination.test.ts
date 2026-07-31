import { describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import { forEachCanonicalTrendingSourcePage } from "./canonicalTrendingPagination";

describe("canonical Trending source pagination", () => {
  it("consumes each page without returning the accumulated source rows", async () => {
    const pages = [
      { page: [{ id: "one" }, { id: "two" }], documentsRead: 2 },
      { page: [{ id: "three" }], documentsRead: 1 },
    ];
    const runQuery = vi.fn(
      async (_ref: never, args: { paginationOpts: { cursor: string | null } }) => {
        const index = args.paginationOpts.cursor === null ? 0 : 1;
        return {
          ...pages[index],
          isDone: index === pages.length - 1,
          continueCursor: index === pages.length - 1 ? "" : "next-page",
        };
      },
    );
    const visited: string[][] = [];

    const result = await forEachCanonicalTrendingSourcePage(
      { runQuery: runQuery as unknown as ActionCtx["runQuery"] },
      Symbol("source"),
      {},
      (page) => {
        visited.push((page as Array<{ id: string }>).map((row) => row.id));
      },
    );

    expect(visited).toEqual([["one", "two"], ["three"]]);
    expect(result).toEqual({ documentsRead: 3, functionCalls: 2 });
    expect(result).not.toHaveProperty("rows");
  });
});
