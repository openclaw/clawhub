import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPackageActivityTrendForName, getSkillActivityTrendForSlug } from "./activityTrend";
import {
  useDeferredPackageActivityTrend,
  useDeferredSkillActivityTrend,
} from "./useDeferredActivityTrend";

const { query, client } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return { query: mockQuery, client: { query: mockQuery } };
});
vi.mock("convex/react", () => ({ useConvex: () => client }));

const trend = {
  downloads: { range: "daily", days: 1, total: 2, points: [{ day: 20_000, value: 2 }] },
};
const initial = { name: "weather", endDay: 20_000, ownerHandle: "publisher" };
type Params = { name: string | null; endDay: number; ownerHandle?: string };

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  query.mockReset().mockResolvedValue(trend);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.each([
  {
    kind: "skill",
    reference: getSkillActivityTrendForSlug,
    args: { slug: "weather", endDay: 20_000, ownerHandle: "publisher" },
    useTrend: (p: Params) =>
      useDeferredSkillActivityTrend(
        p.name === null ? null : { slug: p.name, endDay: p.endDay, ownerHandle: p.ownerHandle },
      ),
  },
  {
    kind: "package",
    reference: getPackageActivityTrendForName,
    args: { name: "weather", endDay: 20_000 },
    useTrend: (p: Params) =>
      useDeferredPackageActivityTrend(p.name === null ? null : { name: p.name, endDay: p.endDay }),
  },
])("$kind activity trend", ({ useTrend, reference, args }) => {
  it("defers exactly 750ms across equal renders and resets on a new day", async () => {
    const { result, rerender } = renderHook(useTrend, { initialProps: initial });
    expect(result.current).toEqual({ loading: true, trend: null });
    await advance(749);
    rerender({ ...initial });
    expect(query).not.toHaveBeenCalled();
    await advance(1);
    expect(query).toHaveBeenCalledExactlyOnceWith(reference, args);
    expect(result.current).toEqual({ loading: false, trend });
    rerender({ ...initial, endDay: 20_001 });
    expect(result.current).toEqual({ loading: true, trend: null });
    await advance(750);
    expect(query).toHaveBeenLastCalledWith(reference, { ...args, endDay: 20_001 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("skips null inputs and cancels the timer on reset or unmount", async () => {
    const { result, rerender, unmount } = renderHook(useTrend, {
      initialProps: { ...initial, name: null } as Params,
    });
    expect(result.current).toEqual({ loading: false, trend: null });
    await advance(750);
    rerender(initial);
    await advance(749);
    rerender({ ...initial, name: null });
    expect(result.current).toEqual({ loading: false, trend: null });
    await advance(1);
    rerender(initial);
    unmount();
    await advance(750);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a stale %s after the next response",
    async (settle) => {
      const stale = deferred();
      const current = deferred();
      query.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
      const { result, rerender } = renderHook(useTrend, { initialProps: initial });
      await advance(750);
      rerender({ ...initial, name: "other" });
      expect(result.current).toEqual({ loading: true, trend: null });
      await advance(750);
      await act(async () => {
        current.resolve(trend);
      });
      expect(result.current).toEqual({ loading: false, trend });
      await act(async () => {
        if (settle === "resolve")
          stale.resolve({ ...trend, downloads: { ...trend.downloads, total: 99 } });
        else stale.reject(new Error("stale request"));
      });
      expect(result.current).toEqual({ loading: false, trend });
    },
  );

  it.each(["invalid", "failed"])("clears loading after an %s response", async (outcome) => {
    if (outcome === "invalid") query.mockResolvedValueOnce({});
    else query.mockRejectedValueOnce(new Error("request failed"));
    const { result } = renderHook(useTrend, { initialProps: initial });
    await advance(750);
    expect(result.current).toEqual({ loading: false, trend: null });
  });
});

it("rekeys skill requests when the owner changes and omits an empty owner", async () => {
  const { result, rerender } = renderHook(useDeferredSkillActivityTrend, {
    initialProps: { slug: "weather", endDay: 20_000, ownerHandle: "" },
  });
  await advance(750);
  expect(query).toHaveBeenLastCalledWith(getSkillActivityTrendForSlug, {
    slug: "weather",
    endDay: 20_000,
  });
  rerender({ slug: "weather", endDay: 20_000, ownerHandle: "publisher" });
  expect(result.current).toEqual({ loading: true, trend: null });
  await advance(750);
  expect(query).toHaveBeenLastCalledWith(getSkillActivityTrendForSlug, {
    slug: "weather",
    endDay: 20_000,
    ownerHandle: "publisher",
  });
  expect(query).toHaveBeenCalledTimes(2);
});
