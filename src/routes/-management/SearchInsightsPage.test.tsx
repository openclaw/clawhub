import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchInsightReport } from "../../../convex/lib/searchInsights";
import { SearchInsightsPage } from "./SearchInsightsPage";

const { getReport, getRecommendations } = vi.hoisted(() => ({
  getReport: vi.fn(),
  getRecommendations: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "featuredIntelligence:get" ? getRecommendations : getReport,
}));
beforeEach(() => vi.resetAllMocks());

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
          candidates: [
            {
              id: "plugin:calendar",
              displayName: "Calendar connector",
              summary: "Keep events synchronized.",
              url: "/plugins/calendar",
              category: "productivity",
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
      })
      .mockRejectedValueOnce(new Error("Catalog unavailable"));
    render(<SearchInsightsPage />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("combobox", { name: "View" }), {
      target: { value: "featured" },
    });
    await screen.findByRole("link", { name: "Calendar connector" });
    expect(screen.getByText(/40 downloads/)).toBeTruthy();
    expect(screen.getByText(/No matching collected search demand/)).toBeTruthy();
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
  });
});
