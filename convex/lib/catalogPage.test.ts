/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  type CatalogSourceCursorState,
  finalizeCatalogSource,
  initCatalogSource,
  mergeCatalogSources,
} from "./catalogPage";

const initial = { cursor: null, offset: 0, pageSize: null, done: false };
const compare = (a: { rank: number }, b: { rank: number }) => a.rank - b.rank;

function reader(pages: number[][], state: CatalogSourceCursorState = initial) {
  const source = initCatalogSource<{ rank: number }>(state);
  const fetchPage = vi.fn(async (cursor: string | null, _pageSize: number) => {
    const index = Number(cursor ?? 0);
    return {
      page: pages[index].map((rank) => ({ rank })),
      isDone: index === pages.length - 1,
      continueCursor: String(index + 1),
    };
  });
  return { source, fetchPage };
}

describe("mergeCatalogSources", () => {
  it("resumes buffered pages with their original page size and preserves left ties", async () => {
    const left = reader([[1, 3], [], [5]]);
    const right = reader([[2, 3, 4]]);
    const first = await mergeCatalogSources({ left, right, limit: 3, compare });
    expect(first.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(first[2]).toBe(left.source.page?.page[1]);
    expect(finalizeCatalogSource(left.source)).toEqual({
      cursor: "1",
      offset: 0,
      pageSize: 3,
      done: false,
    });
    expect(finalizeCatalogSource(right.source)).toEqual({
      cursor: null,
      offset: 1,
      pageSize: 3,
      done: false,
    });

    const resumedLeft = reader([[1, 3], [], [5]], finalizeCatalogSource(left.source));
    const resumedRight = reader([[2, 3, 4]], finalizeCatalogSource(right.source));
    const second = await mergeCatalogSources({
      left: resumedLeft,
      right: resumedRight,
      limit: 10,
      compare,
    });
    expect(second.map((item) => item.rank)).toEqual([3, 4, 5]);
    expect(resumedLeft.fetchPage.mock.calls).toEqual([
      ["1", 3],
      ["2", 3],
    ]);
    expect(resumedRight.fetchPage.mock.calls).toEqual([[null, 3]]);
    expect(finalizeCatalogSource(resumedLeft.source)).toEqual({
      cursor: "3",
      offset: 0,
      pageSize: 3,
      done: true,
    });
    expect(finalizeCatalogSource(resumedRight.source)).toEqual({
      cursor: "1",
      offset: 0,
      pageSize: 3,
      done: true,
    });
  });

  it("does not fetch beyond the limit or change disabled sources", async () => {
    const left = reader([[1], [2]]);
    const disabled = reader([[0]]);
    expect(await mergeCatalogSources({ left, right: null, limit: 1, compare })).toEqual([
      { rank: 1 },
    ]);
    expect(left.fetchPage.mock.calls).toEqual([[null, 1]]);
    expect(finalizeCatalogSource(disabled.source)).toEqual(initial);
    expect(disabled.fetchPage).not.toHaveBeenCalled();
    expect(await mergeCatalogSources({ left: null, right: null, limit: 5, compare })).toEqual([]);
  });

  it("reads a buffered final-page tail even when its cursor is marked done", async () => {
    const right = reader([[1, 2, 3]], {
      cursor: null,
      offset: 1,
      pageSize: 3,
      done: true,
    });
    const left = reader([[]], { ...initial, done: true });
    expect(await mergeCatalogSources({ left, right, limit: 5, compare })).toEqual([
      { rank: 2 },
      { rank: 3 },
    ]);
    expect(left.fetchPage).not.toHaveBeenCalled();
    expect(right.fetchPage.mock.calls).toEqual([[null, 3]]);
  });

  it("starts both reads before awaiting either and propagates failures without consuming items", async () => {
    const left = reader([[1]]);
    const right = reader([[2]]);
    const error = new Error("page unavailable");
    // Deferring the assertion lets both fetches start in the same Promise.all turn.
    left.fetchPage.mockImplementationOnce(async () => {
      await Promise.resolve();
      expect(right.fetchPage).toHaveBeenCalledOnce();
      throw error;
    });
    await expect(mergeCatalogSources({ left, right, limit: 2, compare })).rejects.toBe(error);
    expect(left.source.index).toBe(0);
    expect(right.source.index).toBe(0);
  });
});
