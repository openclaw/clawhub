import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAppearancePage, type AppearancePage } from "./appearance";
import { useAppearanceCatalog } from "./useAppearanceCatalog";
vi.mock("./appearance", () => ({ fetchAppearancePage: vi.fn() }));
const theme = (id: string) => ({
  id,
  name: id,
  description: "A theme",
  version: "1.0.0",
  category: "themes" as const,
  author: { handle: "alice" },
  updatedAt: 1,
});
const page = (ids: string[], nextCursor: string | null = null): AppearancePage => ({
  kind: "themes",
  items: ids.map(theme),
  nextCursor,
});
beforeEach(() => {
  vi.mocked(fetchAppearancePage).mockReset();
});
describe("Appearance query and cursor ownership", () => {
  it("shows loading, retains items and cursor on failed pagination, retries the same page and deduplicates", async () => {
    vi.mocked(fetchAppearancePage)
      .mockResolvedValueOnce(page(["one"], "cursor-one"))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(page(["one", "two"]));
    const { result } = renderHook(() => useAppearanceCatalog("themes", "blue"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.page?.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe("Offline"));
    expect(result.current.page?.items).toHaveLength(1);
    expect(result.current.page?.nextCursor).toBe("cursor-one");
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.page?.items).toHaveLength(2));
    expect(vi.mocked(fetchAppearancePage).mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ["themes", "blue", null],
      ["themes", "blue", "cursor-one"],
      ["themes", "blue", "cursor-one"],
    ]);
    expect(result.current.error).toBeNull();
  });
  it("continues through an empty filtered page with a cursor", async () => {
    vi.mocked(fetchAppearancePage)
      .mockResolvedValueOnce(page([], "filtered-cursor"))
      .mockResolvedValueOnce(page(["visible"]));
    const { result } = renderHook(() => useAppearanceCatalog("themes", ""));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.page?.nextCursor).toBe("filtered-cursor");
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.page?.items).toHaveLength(1));
  });
  it("retries failed first pages without inventing a cursor", async () => {
    vi.mocked(fetchAppearancePage)
      .mockRejectedValueOnce(new Error("No connection"))
      .mockResolvedValueOnce(page([]));
    const { result } = renderHook(() => useAppearanceCatalog("themes", ""));
    await waitFor(() => expect(result.current.error).toBe("No connection"));
    expect(result.current.page).toBeNull();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.page?.items).toEqual([]));
    expect(vi.mocked(fetchAppearancePage).mock.calls[1][2]).toBeNull();
  });
  it("cancels a stale response and never reuses a theme cursor for a pack query", async () => {
    let resolveOld!: (page: AppearancePage) => void;
    vi.mocked(fetchAppearancePage)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ kind: "packs", items: [], nextCursor: "pack-cursor" });
    const { result, rerender } = renderHook(
      ({ view, query }: { view: "themes" | "packs"; query: string }) =>
        useAppearanceCatalog(view, query),
      { initialProps: { view: "themes", query: "old" } },
    );
    const oldSignal = vi.mocked(fetchAppearancePage).mock.calls[0][3];
    rerender({ view: "packs", query: "new" });
    await waitFor(() => expect(result.current.page?.kind).toBe("packs"));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => resolveOld(page(["stale"], "theme-cursor")));
    expect(result.current.page).toEqual({ kind: "packs", items: [], nextCursor: "pack-cursor" });
    expect(vi.mocked(fetchAppearancePage).mock.calls[1].slice(0, 3)).toEqual([
      "packs",
      "new",
      null,
    ]);
  });
  it("turns a stalled request into a retryable timeout", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchAppearancePage).mockImplementation(() => new Promise(() => {}));
      const { result, unmount } = renderHook(() => useAppearanceCatalog("themes", ""));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_001);
      });
      expect(result.current.error).toBe("Request timed out. Please retry.");
      expect(result.current.loading).toBe(false);
      expect(result.current.page).toBeNull();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("aborts its in-flight request when unmounted", () => {
    vi.mocked(fetchAppearancePage).mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderHook(() => useAppearanceCatalog("themes", ""));
    const signal = vi.mocked(fetchAppearancePage).mock.calls[0][3];
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
