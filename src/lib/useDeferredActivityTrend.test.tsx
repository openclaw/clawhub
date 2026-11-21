import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { deferred } from "../__tests__/helpers/deferred";
import { useDownloadsSidebarMetricBlock } from "../components/DownloadsMetricCard";
import {
  useDeferredPackageActivityTrend,
  useDeferredSkillActivityTrend,
} from "./useDeferredActivityTrend";

const { socketQuery, client } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return { socketQuery: mockQuery, client: { query: mockQuery } };
});
vi.mock("convex/react", () => ({ useConvex: () => client }));
const { httpQuery } = vi.hoisted(() => ({ httpQuery: vi.fn() }));
vi.mock("../convex/client", () => ({ convexHttp: { query: httpQuery } }));

const trend = {
  downloads: { range: "daily", days: 1, total: 2, points: [{ day: 20_000, value: 2 }] },
};
const initial = { name: "weather", endDay: 20_000, ownerHandle: "publisher" };
type Params = { name: string | null; endDay: number; ownerHandle?: string };

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  socketQuery.mockReset().mockResolvedValue(trend);
  httpQuery.mockReset().mockResolvedValue(trend);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.each([
  {
    kind: "skill",
    query: httpQuery,
    reference: api.skills.getActivityTrendForSlug,
    args: { slug: "weather", endDay: 20_000, ownerHandle: "publisher" },
    useTrend: (p: Params) =>
      useDeferredSkillActivityTrend(
        p.name === null ? null : { slug: p.name, endDay: p.endDay, ownerHandle: p.ownerHandle },
      ),
  },
  {
    kind: "package",
    query: socketQuery,
    reference: api.packages.getActivityTrendForName,
    args: { name: "weather", endDay: 20_000 },
    useTrend: (p: Params) =>
      useDeferredPackageActivityTrend(p.name === null ? null : { name: p.name, endDay: p.endDay }),
  },
])("$kind activity trend", ({ useTrend, reference, args, query }) => {
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
      const stale = deferred<unknown>();
      const current = deferred<unknown>();
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

it("loads public skill downloads over HTTP without a connected realtime client", async () => {
  socketQuery.mockReturnValue(new Promise(() => {}));
  httpQuery.mockResolvedValue(trend);
  const { result } = renderHook(useDeferredSkillActivityTrend, {
    initialProps: { slug: "weather", ownerHandle: "publisher", endDay: 20_000 },
  });
  await advance(750);
  expect(result.current).toEqual({ loading: false, trend });
  expect(socketQuery).not.toHaveBeenCalled();
  expect(httpQuery).toHaveBeenCalledExactlyOnceWith(api.skills.getActivityTrendForSlug, {
    slug: "weather",
    ownerHandle: "publisher",
    endDay: 20_000,
  });
});

it("rekeys skill requests when the owner changes and omits an empty owner", async () => {
  const { result, rerender } = renderHook(useDeferredSkillActivityTrend, {
    initialProps: { slug: "weather", endDay: 20_000, ownerHandle: "" },
  });
  await advance(750);
  expect(httpQuery).toHaveBeenLastCalledWith(api.skills.getActivityTrendForSlug, {
    slug: "weather",
    endDay: 20_000,
  });
  rerender({ slug: "weather", endDay: 20_000, ownerHandle: "publisher" });
  expect(result.current).toEqual({ loading: true, trend: null });
  await advance(750);
  expect(httpQuery).toHaveBeenLastCalledWith(api.skills.getActivityTrendForSlug, {
    slug: "weather",
    endDay: 20_000,
    ownerHandle: "publisher",
  });
  expect(httpQuery).toHaveBeenCalledTimes(2);
});

it("keeps download-period order, visible labels, accessible graph labels, and totals aligned", () => {
  const downloads = {
    range: "daily" as const,
    days: 30,
    total: 465,
    points: Array.from({ length: 30 }, (_, index) => ({ day: 20_000 + index, value: index + 1 })),
  };
  function Sidebar() {
    const block = useDownloadsSidebarMetricBlock({
      allTimeDownloads: 999,
      activityTrend: downloads,
    });
    return (
      <div>
        {block.label}
        {block.value}
      </div>
    );
  }
  const { container } = render(<Sidebar />);
  const tabs = within(screen.getByRole("tablist", { name: "Download period" })).getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["All time", "30d", "7d"]);
  expect(screen.getByRole("tab", { name: "30d" }).getAttribute("aria-selected")).toBe("true");
  for (const [tab, label, ariaLabel, total] of [
    ["30d", "30 days", "Daily downloads over the last 30 days", "465"],
    ["All time", "All time", "Recent daily downloads with all-time total", "999"],
    ["7d", "7 days", "Daily downloads over the last 7 days", "189"],
  ]) {
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    expect(screen.getByRole("tab", { name: tab }).getAttribute("aria-selected")).toBe("true");
    const chart = screen.getByRole("img", { name: ariaLabel });
    expect(
      container.querySelector(`[id="${chart.getAttribute("aria-describedby")}"]`)?.textContent,
    ).toBe(label);
    expect(container.querySelector(".metric-trend-value-row strong")?.textContent).toBe(total);
  }
});
