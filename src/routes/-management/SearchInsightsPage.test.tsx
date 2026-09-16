import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchInsightReport } from "../../../convex/lib/searchInsights";
import { SearchInsightsPage } from "./SearchInsightsPage";

const { getReport, getRecommendations, startReport, getResult, requests, statuses } = vi.hoisted(
  () => ({
    getReport: vi.fn(),
    getRecommendations: vi.fn(),
    startReport: vi.fn(),
    getResult: vi.fn(),
    requests: new Map<string, Record<string, unknown>>(),
    statuses: new Map<string, Record<string, unknown> | null>(),
  }),
);
vi.mock("convex/react", () => ({
  useAction: () => getResult,
  useMutation: () => startReport,
  useQuery: (_ref: unknown, args: { reportId: string } | "skip") =>
    args === "skip" ? undefined : statuses.get(args.reportId),
}));
beforeEach(() => {
  vi.resetAllMocks();
  requests.clear();
  statuses.clear();
  startReport.mockImplementation(async (input) => {
    const reportId = `report-${requests.size + 1}`;
    requests.set(reportId, input);
    const status = {
      reportId,
      view: input.view,
      status: "ready",
      requestedAt: report.generatedAt,
      completedAt: report.generatedAt,
      expirationTime: report.generatedAt + 86_400_000,
      previousAttempts: 0,
      failureCode: null,
      reportVersion: "search-report-v1",
    };
    statuses.set(reportId, status);
    return status;
  });
  getResult.mockImplementation(async ({ reportId }) => {
    const input = requests.get(reportId)!;
    const value = await (input.view === "recommendations" ? getRecommendations : getReport)(input);
    return { ...statuses.get(reportId), report: value };
  });
});

const report: SearchInsightReport = {
  artifactKind: "plugin",
  scope: null,
  window: { endDay: 1_789_430_400_000, start7d: 0, startPrevious7d: 0, start30d: 0, days: 7 },
  source: null,
  generatedAt: 1_789_430_400_000,
  metadataCheckedAt: null,
  currentMetadataStatus: "unavailable",
  coverage: { dataThrough: null, collectionStartedAt: null, gapStart: null, gapEnd: null },
  totalQueries: 0,
  totalSearches7d: 33,
  sources7d: { "clawhub-web": 26, "openclaw-control-ui": 7 },
  truncated: false,
  classificationStatus: "unavailable",
  classificationRun: null,
  rows: [],
};

describe("SearchInsightsPage", () => {
  it("shows adoption candidates with no search demand and clears them when a catalog load fails", async () => {
    getReport.mockResolvedValue({ ...report, totalSearches7d: 0 });
    getRecommendations
      .mockResolvedValueOnce({
        searchReport: { ...report, totalSearches7d: 0 },
        metadataCheckedAt: report.generatedAt,
        adoption: {
          status: "available",
          generatedAt: report.generatedAt,
          periodStart: report.generatedAt - 86_400_000,
          periodEnd: report.generatedAt,
          totalItems: 1,
          inspectedItems: 1,
          truncated: false,
        },
        recommendations: {
          totalCandidates: 1,
          omittedCandidates: 0,
          excluded: [],
          candidates: [],
          lineup: {
            targetSize: 8,
            baseline: [],
            removals: [],
            shortfall: 7,
            proposed: [
              {
                id: "plugin:calendar",
                displayName: "Calendar connector",
                summary: "Keep events synchronized.",
                url: "/plugins/calendar",
                category: "productivity",
                change: "add",
                emerging: true,
                support: "adoption-only",
                search: null,
                adoption: {
                  source: "package-trending",
                  rank: 1,
                  downloads: 40,
                  installs: 3,
                  bookmarks: null,
                  snapshotId: "observed",
                  rankingVersion: "unversioned",
                  generatedAt: report.generatedAt,
                  periodStart: report.generatedAt - 86_400_000,
                  periodEnd: report.generatedAt,
                  lifetimeInstalls: null,
                  sourceObservedAt: null,
                },
              },
            ],
          },
        },
      })
      .mockRejectedValueOnce(new Error("Catalog unavailable"));
    render(<SearchInsightsPage />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("combobox", { name: "View" }), {
      target: { value: "featured" },
    });
    await screen.findByRole("link", { name: "Calendar connector" });
    expect(screen.getByText(/40 downloads/)).toBeTruthy();
    expect(screen.getByText(/1 of 8 plugins/)).toBeTruthy();
    expect(screen.getByText(/7 open Featured places/)).toBeTruthy();
    expect(screen.getByText(/Add · Emerging · Adoption/)).toBeTruthy();
    expect(screen.getByText(/No search evidence in the inspected queries/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Catalog" }), {
      target: { value: "skill" },
    });
    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: "Calendar connector" })).toBeNull();
    expect(getRecommendations.mock.lastCall?.[0].artifactKind).toBe("skill");
  });
  it("removes the previous report when a filter fails and shows the selected source after retry", async () => {
    getReport
      .mockResolvedValueOnce(report)
      .mockRejectedValueOnce(new Error("Report unavailable"))
      .mockResolvedValueOnce({
        ...report,
        source: "openclaw-control-ui",
        totalSearches7d: 7,
        sources7d: { "clawhub-web": 0, "openclaw-control-ui": 7 },
      });
    render(<SearchInsightsPage />);
    await screen.findByText("33");

    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), {
      target: { value: "openclaw-control-ui" },
    });
    await screen.findByRole("alert");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("33")).toBeNull();
    expect(screen.queryByText("searches in 7 days")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("table");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("33")).toBeNull();
    expect(screen.getAllByText("7")).toHaveLength(2);
    expect(getReport.mock.lastCall?.[0].source).toBe("openclaw-control-ui");
    expect(startReport.mock.lastCall?.[0].refreshOf).toBe("report-2");
  });
  it("shows queued and running analysis, then loads the completed report without mixing older filters", async () => {
    let finishOld: (value: SearchInsightReport) => void = () => {};
    getReport
      .mockImplementationOnce(
        () =>
          new Promise<SearchInsightReport>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...report, artifactKind: "skill", totalSearches7d: 9 });
    const firstStart = startReport.getMockImplementation()!;
    startReport.mockImplementation(async (input) => {
      const value = await firstStart(input);
      const pending = { ...value, status: "pending", completedAt: null };
      statuses.set(value.reportId, pending);
      return pending;
    });
    const page = render(<SearchInsightsPage />);
    await waitFor(() => expect(startReport).toHaveBeenCalledTimes(1));
    await screen.findByText("Waiting to generate the report…");
    expect(getResult).not.toHaveBeenCalled();
    statuses.set("report-1", { ...statuses.get("report-1"), status: "running" });
    page.rerender(<SearchInsightsPage />);
    expect(screen.getByText("Analyzing search demand…")).toBeTruthy();
    statuses.set("report-1", {
      ...statuses.get("report-1"),
      status: "ready",
      completedAt: report.generatedAt,
    });
    page.rerender(<SearchInsightsPage />);
    await waitFor(() => expect(getReport).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("combobox", { name: "Catalog" }), {
      target: { value: "skill" },
    });
    await waitFor(() => expect(startReport).toHaveBeenCalledTimes(2));
    await act(async () => finishOld(report));
    expect(screen.queryByText("33")).toBeNull();
    statuses.set("report-2", {
      ...statuses.get("report-2"),
      status: "ready",
      completedAt: report.generatedAt,
    });
    page.rerender(<SearchInsightsPage />);
    await screen.findByText("9");
    expect(screen.queryByText("33")).toBeNull();
  });
  it("advances the default UTC window at midnight and refreshes that day's generation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T23:59:45Z"));
    getReport.mockResolvedValue(report);
    let page: ReturnType<typeof render> | undefined;
    try {
      await act(async () => {
        page = render(<SearchInsightsPage />);
      });
      expect(screen.getByRole("table")).toBeTruthy();
      expect(startReport).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(startReport).toHaveBeenCalledTimes(2);
      expect(startReport.mock.lastCall?.[0]).toMatchObject({
        endDay: Date.parse("2026-09-16T00:00:00Z"),
      });
      expect(startReport.mock.lastCall?.[0].refreshOf).toBeUndefined();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      });
      expect(startReport.mock.lastCall?.[0]).toMatchObject({
        endDay: Date.parse("2026-09-16T00:00:00Z"),
        refreshOf: "report-2",
      });
    } finally {
      page?.unmount();
      vi.useRealTimers();
    }
  });
  it("can start again when a refresh parent disappears during admission", async () => {
    getReport.mockResolvedValue(report);
    render(<SearchInsightsPage />);
    await screen.findByRole("table");
    startReport.mockRejectedValueOnce(new Error("report_not_found"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("alert");
    expect(startReport.mock.lastCall?.[0].refreshOf).toBe("report-1");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("table");
    expect(startReport.mock.lastCall?.[0].refreshOf).toBeUndefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each(["failed", "expired", "incomplete", "removed"])(
    "shows a visible %s outcome and allows a new generation",
    async (terminal) => {
      getReport.mockResolvedValue(report);
      const page = render(<SearchInsightsPage />);
      await screen.findByText("33");
      statuses.set(
        "report-1",
        terminal === "removed" ? null : { ...statuses.get("report-1"), status: terminal },
      );
      page.rerender(<SearchInsightsPage />);
      expect(screen.getByRole("alert").textContent).toContain("report");
      expect(screen.queryByRole("table")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await screen.findByRole("table");
      expect(startReport.mock.lastCall?.[0].refreshOf).toBe(
        terminal === "removed" ? undefined : "report-1",
      );
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
});
