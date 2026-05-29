/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Management } from "./management";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useActionMock = vi.fn();
const navigateMock = vi.fn();
let searchState: Record<string, string | undefined> = {};

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: object) => ({
    ...config,
    useSearch: () => searchState,
  }),
  Link: ({
    children,
    to,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: unknown;
  }) => <a href={to}>{children}</a>,
  useNavigate: () => navigateMock,
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => ({
    me: {
      _id: "users:admin",
      handle: "admin",
      role: "admin",
    },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

describe("Management", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useActionMock.mockReset();
    navigateMock.mockReset();
    searchState = {};
    useMutationMock.mockReturnValue(vi.fn());
    useActionMock.mockReturnValue(vi.fn());
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          summary: {
            pendingTotal: 0,
            potentialBanCandidate: 0,
            review: 0,
            pass: 0,
            reviewedNoAction: 0,
            falsePositive: 0,
            needsPolicyDiscussion: 0,
            candidateForFutureAction: 0,
          },
          latestRun: null,
          pendingItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });
  });

  it("renders the publisher abuse review dashboard for staff", () => {
    render(<Management />);

    expect(screen.getByRole("navigation", { name: "Management sections" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Publisher abuse review" })).toBeTruthy();
  });

  it("shows users as a separate management view", () => {
    searchState = { view: "users" };

    render(<Management />);

    expect(screen.getByRole("heading", { name: "Users" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Publisher abuse review" })).toBeNull();
  });

  it("shows recent pushes as a separate management view", () => {
    searchState = { view: "recent" };

    render(<Management />);

    expect(screen.getByRole("heading", { name: "Recent pushes" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Publisher abuse review" })).toBeNull();
  });

  it("shows duplicate candidates as a separate management view", () => {
    searchState = { view: "duplicates" };

    render(<Management />);

    expect(screen.getByRole("heading", { name: "Duplicate candidates" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Publisher abuse review" })).toBeNull();
  });

  it("renders nomination rows in the trimmed queue table with detail in the inspector", () => {
    const score = {
      _id: "publisherAbuseScores:1",
      runId: "publisherAbuseScoreRuns:1",
      ownerKey: "user:spammy",
      ownerPublisherId: undefined,
      ownerUserId: "users:spammy",
      handleSnapshot: "spammy-pub",
      modelVersion: "v1",
      label: "potential_ban_candidate",
      rank: 1,
      pressure: 9,
      logPressure: 2,
      zScore: 3.1,
      publishedSkills: 120,
      totalInstalls: 12,
      totalStars: 1,
      totalDownloads: 30,
      installsPerSkill: 0.1,
      starsPerSkill: 0.01,
      downloadsPerSkill: 0.25,
      reasonCodes: ["extreme_volume_low_engagement", "low_installs_per_skill"],
      createdAt: 1716000000000,
    };
    const nomination = {
      _id: "publisherAbuseReviewNominations:1",
      ownerKey: "user:spammy",
      ownerPublisherId: undefined,
      ownerUserId: "users:spammy",
      handleSnapshot: "spammy-pub",
      latestScoreId: "publisherAbuseScores:1",
      modelVersion: "v1",
      label: "potential_ban_candidate",
      status: "pending",
      openedAt: 1,
      openedByRunId: "publisherAbuseScoreRuns:1",
      lastScoredAt: 1716000000000,
      reviewedByUserId: undefined,
      reviewedAt: undefined,
      notes: undefined,
      updatedAt: 1,
    };
    const item = {
      nomination,
      latestScore: score,
      publisher: null,
      ownerUser: { _id: "users:spammy", handle: "spammy", name: "Spammy", displayName: null },
      openedByRun: null,
    };

    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          summary: {
            pendingTotal: 1,
            potentialBanCandidate: 1,
            review: 0,
            pass: 0,
            reviewedNoAction: 0,
            falsePositive: 0,
            needsPolicyDiscussion: 0,
            candidateForFutureAction: 0,
          },
          latestRun: {
            status: "completed",
            startedAt: 1715000000000,
            completedAt: 1716000000000,
            phase: "completed",
            scannedPublishers: 194083,
            scoredPublishers: 10349,
            reviewCount: 0,
            potentialBanCandidateCount: 1,
          },
          pendingItems: [item],
          recentResolvedItems: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    // Trimmed queue keeps these column headers...
    expect(screen.getByRole("columnheader", { name: "Z-score" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Reasons" })).toBeTruthy();
    // ...and drops the per-skill ratio columns (moved to the detail drawer) and the
    // redundant always-"pending" status column.
    expect(screen.queryByRole("columnheader", { name: "Installs / Skill" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Rank" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Status" })).toBeNull();
    // Empty-state copy must not show when there are rows.
    expect(screen.queryByText("Queue clear")).toBeNull();

    // The handle shows in the queue row; the detail drawer is closed until a
    // row is clicked, so detail-only content is not on screen yet.
    expect(screen.getAllByText("spammy-pub").length).toBe(1);
    expect(screen.queryByText("Published skills")).toBeNull();

    // Clicking the row opens the detail drawer with the full metrics.
    fireEvent.click(screen.getByText("spammy-pub"));
    expect(screen.getByText("Published skills")).toBeTruthy();
    expect(screen.getAllByText("spammy-pub").length).toBeGreaterThanOrEqual(2);
  });
});
