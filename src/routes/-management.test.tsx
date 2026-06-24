/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Management } from "./management";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useActionMock = vi.fn();
const navigateMock = vi.fn();
let searchState: Record<string, string | undefined> = {};
let authUser: { _id: string; handle: string; role: "admin" | "moderator" | "user" } = {
  _id: "users:admin",
  handle: "admin",
  role: "admin",
};

function makePublisherAbuseItem({
  handle = "spammy-pub",
  id = "1",
  label = "potential_ban_candidate",
  ownerKey = "user:spammy",
  ownerRole = "user",
  ownerUserId = "users:spammy",
  openedByRun = null,
  rank = Number(id),
  scoreOverrides = {},
  scoreRunId = "publisherAbuseScoreRuns:1",
  status = "pending",
  zScore = 3.1,
} = {}) {
  const score = {
    _id: `publisherAbuseScores:${id}`,
    runId: scoreRunId,
    ownerKey,
    ownerPublisherId: undefined,
    ownerUserId,
    handleSnapshot: handle,
    modelVersion: "v1",
    label,
    rank,
    pressure: 9,
    logPressure: 2,
    zScore,
    publishedSkills: 120,
    totalInstalls: 12,
    totalStars: 1,
    totalDownloads: 30,
    installsPerSkill: 0.1,
    starsPerSkill: 0.01,
    downloadsPerSkill: 0.25,
    reasonCodes: ["extreme_volume_low_engagement", "low_installs_per_skill"],
    createdAt: 1716000000000,
    ...scoreOverrides,
  };
  const nomination = {
    _id: `publisherAbuseReviewNominations:${id}`,
    ownerKey,
    ownerPublisherId: undefined,
    ownerUserId,
    handleSnapshot: handle,
    latestScoreId: `publisherAbuseScores:${id}`,
    modelVersion: "v1",
    label,
    status,
    openedAt: 1,
    openedByRunId: "publisherAbuseScoreRuns:1",
    lastScoredAt: 1716000000000 + Number(id),
    reviewedByUserId: status === "pending" ? undefined : "users:moderator",
    reviewedAt: status === "pending" ? undefined : 1716000005000,
    notes: status === "pending" ? undefined : "already checked",
    updatedAt: 1,
  };
  return {
    nomination,
    latestScore: score,
    publisher: null,
    ownerUser: {
      _id: ownerUserId,
      handle: ownerUserId.split(":").at(-1) ?? "spammy",
      name: handle,
      displayName: null,
      role: ownerRole,
    },
    openedByRun,
  };
}

function makeManagementUser(
  id: string,
  handle: string,
  role: "admin" | "moderator" | "user" = "user",
) {
  return {
    _id: id,
    _creationTime: 1,
    handle,
    name: handle,
    displayName: handle,
    role,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeSelectedSkill(owner = makeManagementUser("users:owner", "owner")) {
  return {
    skill: {
      _id: "skills:owned",
      _creationTime: 1,
      slug: "owned-skill",
      displayName: "Owned Skill",
      ownerUserId: owner._id,
      updatedAt: 1716000000000,
      badges: {},
      moderationFlags: [],
    },
    latestVersion: null,
    owner: {
      _id: `publishers:${owner.handle}`,
      _creationTime: 1,
      kind: "user",
      handle: owner.handle,
      displayName: owner.displayName,
      linkedUserId: owner._id,
    },
    overrideReviewer: null,
    auditLogs: [],
    canonical: null,
  };
}

function linkHref(to: string, search: unknown) {
  if (!search || typeof search !== "object") return to;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" && value.trim()) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `${to}?${query}` : to;
}

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
    search,
    to,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: unknown;
  }) => <a href={linkHref(to, search)}>{children}</a>,
  useNavigate: () => navigateMock,
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => ({
    me: authUser,
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
    authUser = {
      _id: "users:admin",
      handle: "admin",
      role: "admin",
    };
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
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [],
          pendingReviewItems: [],
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
    expect(screen.getByRole("link", { name: "Users" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Users 0/ })).toBeNull();
  });

  it("shows an empty scan state after the abuse dashboard loads without a run", () => {
    render(<Management />);

    expect(screen.getByText("No scans yet")).toBeTruthy();
  });

  it("shows resolved publisher abuse nominations in a resolved tab", () => {
    const resolvedItem = makePublisherAbuseItem({
      handle: "cleared-pub",
      id: "9",
      label: "review",
      ownerKey: "user:cleared",
      ownerUserId: "users:cleared",
      status: "false_positive",
      zScore: 1.4,
    });
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [],
          pendingReviewItems: [],
          recentResolvedItems: [resolvedItem],
        };
      }
      if (name === "publisherAbuse:getReviewNominationDetail") {
        return { item: resolvedItem, scoreHistory: [] };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    expect(screen.queryByText("cleared-pub")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Resolved/ }));
    fireEvent.click(screen.getByText("cleared-pub"));

    expect(screen.getByText("Resolution")).toBeTruthy();
    expect(screen.getByText("False positive")).toBeTruthy();
    expect(screen.getByText("already checked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
  });

  it("shows only the active publisher abuse tab rows", () => {
    const potentialBanItem = makePublisherAbuseItem();
    const reviewItem = makePublisherAbuseItem({
      handle: "review-pub",
      id: "3",
      label: "review",
      ownerKey: "user:review",
      ownerUserId: "users:review",
      zScore: 1.8,
    });
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [potentialBanItem],
          pendingReviewItems: [reviewItem],
          recentResolvedItems: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    expect(screen.getByText("Showing 1 of 1 nominations")).toBeTruthy();
    expect(screen.getByText("spammy-pub")).toBeTruthy();
    expect(screen.queryByText("review-pub")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /On the brink/ }));

    expect(screen.getByText("Showing 1 of 1 nominations")).toBeTruthy();
    expect(screen.queryByText("spammy-pub")).toBeNull();
    expect(screen.getByText("review-pub")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /All flagged/ }));

    expect(screen.getByText("Showing 2 of 2 nominations")).toBeTruthy();
    expect(screen.getByText("spammy-pub")).toBeTruthy();
    expect(screen.getByText("review-pub")).toBeTruthy();
  });

  it("starts a manual publisher abuse scan without exposing force-new", async () => {
    const startScan = vi.fn(async () => ({
      ok: true,
      runId: "publisherAbuseScoreRuns:manual",
      pages: 1,
      isDone: false,
    }));
    useActionMock.mockImplementation((action) =>
      getFunctionName(action) === "publisherAbuse:startPublisherAbuseScoreRun"
        ? startScan
        : vi.fn(),
    );

    render(<Management />);

    fireEvent.click(screen.getByRole("button", { name: "Run new scan" }));
    fireEvent.click(screen.getByRole("button", { name: "Run scan" }));

    await waitFor(() => {
      expect(startScan).toHaveBeenCalledWith({});
    });
  });

  it("shows users as a separate management view", () => {
    searchState = { view: "users" };

    render(<Management />);

    expect(screen.getByRole("heading", { name: "Users" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Publisher abuse review" })).toBeNull();
    expect(
      useQueryMock.mock.calls.find(
        ([query]) => getFunctionName(query) === "publisherAbuse:listReviewDashboard",
      )?.[1],
    ).toBe("skip");
  });

  it("shows users while unrelated management queues are still loading", () => {
    searchState = { view: "users" };
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    expect(screen.getByRole("heading", { name: "Users" })).toBeTruthy();
    expect(screen.queryByText("Loading management console…")).toBeNull();
  });

  it("routes sidebar links to separate management views", () => {
    render(<Management />);

    expect(screen.getByRole("link", { name: "Publisher abuse" }).getAttribute("href")).toBe(
      "/management?view=abuse",
    );
    expect(screen.getByRole("link", { name: "Content reports" }).getAttribute("href")).toBe(
      "/management?view=reports",
    );
    expect(screen.getByRole("link", { name: "Duplicate candidates" }).getAttribute("href")).toBe(
      "/management?view=duplicates",
    );
    expect(screen.getByRole("link", { name: "Recent pushes" }).getAttribute("href")).toBe(
      "/management?view=recent",
    );
    expect(screen.getByRole("link", { name: "Users" }).getAttribute("href")).toBe(
      "/management?view=users",
    );
  });

  it("does not expose the users sidebar link to moderators", () => {
    authUser = {
      _id: "users:moderator",
      handle: "moderator",
      role: "moderator",
    };

    render(<Management />);

    expect(screen.queryByRole("link", { name: /Users/ })).toBeNull();
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

  it("lets admins toggle publisher abuse autobans from the abuse view", async () => {
    searchState = { view: "abuse" };
    const setAutobanEnabled = vi.fn(async () => ({
      enabled: false,
      updatedAt: 1716000000000,
      updatedByUserId: "users:admin",
    }));
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "publisherAbuse:setPublisherAbuseAutobanEnabled"
        ? setAutobanEnabled
        : vi.fn(),
    );
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "publisherAbuse:getPublisherAbuseAutobanSetting") {
        return {
          enabled: true,
          updatedAt: 1715000000000,
          updatedByUserId: "users:admin",
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    expect(screen.getByRole("heading", { name: "Publisher abuse review" })).toBeTruthy();
    expect(screen.getByText("Auto-ban is on")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Turn off auto-ban" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off auto-ban now" }));

    await waitFor(() => {
      expect(setAutobanEnabled).toHaveBeenCalledWith({ enabled: false });
    });
  });

  it("lets admins re-enable publisher abuse autobans from the abuse view", async () => {
    searchState = { view: "abuse" };
    const setAutobanEnabled = vi.fn(async () => ({
      enabled: true,
      updatedAt: 1716000000000,
      updatedByUserId: "users:admin",
    }));
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "publisherAbuse:setPublisherAbuseAutobanEnabled"
        ? setAutobanEnabled
        : vi.fn(),
    );
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "publisherAbuse:getPublisherAbuseAutobanSetting") {
        return {
          enabled: false,
          updatedAt: 1715000000000,
          updatedByUserId: "users:admin",
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    expect(screen.getByText("Auto-ban is off")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Turn on auto-ban" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn on auto-ban now" }));

    await waitFor(() => {
      expect(setAutobanEnabled).toHaveBeenCalledWith({ enabled: true });
    });
  });

  it("does not let moderators toggle publisher abuse autobans", () => {
    searchState = { view: "abuse" };
    authUser = {
      _id: "users:moderator",
      handle: "moderator",
      role: "moderator",
    };
    const setAutobanEnabled = vi.fn(async () => ({
      enabled: false,
      updatedAt: 1716000000000,
      updatedByUserId: "users:moderator",
    }));
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "publisherAbuse:setPublisherAbuseAutobanEnabled"
        ? setAutobanEnabled
        : vi.fn(),
    );
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "publisherAbuse:getPublisherAbuseAutobanSetting") {
        return {
          enabled: true,
          updatedAt: 1715000000000,
          updatedByUserId: "users:admin",
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    expect(screen.getByText("Auto-ban is on")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Admins only" });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(setAutobanEnabled).not.toHaveBeenCalled();
  });

  it("keeps owner search available in the skill tools view", async () => {
    searchState = { view: "skills", skill: "owned-skill" };
    const currentOwner = makeManagementUser("users:owner", "owner");
    const futureOwner = makeManagementUser("users:future", "future-owner");

    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:getBySlugForStaff") return makeSelectedSkill(currentOwner);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "users:list") {
        return args &&
          typeof args === "object" &&
          "search" in args &&
          args.search === "future-owner"
          ? { items: [futureOwner], total: 1 }
          : { items: [currentOwner], total: 201 };
      }
      return undefined;
    });

    render(<Management />);

    expect(screen.getByRole("heading", { name: "Skill tools" })).toBeTruthy();
    expect(screen.getByText("Showing 1 of 201")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search users by handle"), {
      target: { value: "future-owner" },
    });

    await waitFor(() => {
      expect(screen.getByText("Showing 2 of 2")).toBeTruthy();
      expect(
        useQueryMock.mock.calls.some(([query, args]) => {
          return (
            getFunctionName(query) === "users:list" &&
            args &&
            typeof args === "object" &&
            "search" in args &&
            args.search === "future-owner"
          );
        }),
      ).toBe(true);
    });
  });

  it("renders nomination rows in the trimmed queue table with detail in the inspector", () => {
    const item = makePublisherAbuseItem();
    const secondItem = makePublisherAbuseItem({
      handle: "second-pub",
      id: "2",
      ownerKey: "user:second",
      ownerUserId: "users:second",
      zScore: 2.9,
    });

    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
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
          // The backend returns per-tab queues so one label cannot be hidden by
          // the capped combined list.
          pendingItems: [],
          pendingPotentialBanCandidateItems: [item, secondItem],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "publisherAbuse:getReviewNominationDetail") {
        return {
          item,
          latestScoreRun: {
            _id: "publisherAbuseScoreRuns:detail",
            scoredPublishers: 42,
          },
          scoreHistory: [],
          events: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    // Trimmed queue keeps these column headers.
    expect(screen.getByRole("columnheader", { name: "Z-score" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Reasons" })).toBeTruthy();
    // Empty-state copy must not show when there are rows.
    expect(screen.queryByText("Queue clear")).toBeNull();

    // The handle shows in the queue row; the detail drawer is closed until a
    // row is activated, so detail-only content is not on screen yet.
    expect(screen.getAllByText("spammy-pub").length).toBe(1);
    expect(screen.queryByText("Published skills")).toBeNull();

    // Keyboard activation opens the detail drawer with the full metrics.
    fireEvent.keyDown(screen.getByRole("button", { name: "Open details for spammy-pub" }), {
      key: "Enter",
    });
    expect(screen.getByText("Published skills")).toBeTruthy();
    expect(screen.getByText("of 42 scored")).toBeTruthy();
    expect(screen.getAllByText("spammy-pub").length).toBeGreaterThanOrEqual(2);

    const banReason = screen.getByPlaceholderText("Why are you taking this action? (optional)");
    fireEvent.change(banReason, { target: { value: "first publisher reason" } });
    expect(banReason).toHaveProperty("value", "first publisher reason");

    fireEvent.click(screen.getByText("second-pub"));
    expect(
      screen.getByPlaceholderText("Why are you taking this action? (optional)"),
    ).toHaveProperty("value", "");
  });

  it("closes the abuse drawer when search hides the selected nomination", async () => {
    const item = makePublisherAbuseItem();
    const secondItem = makePublisherAbuseItem({
      handle: "second-pub",
      id: "2",
      ownerKey: "user:second",
      ownerUserId: "users:second",
      zScore: 2.9,
    });

    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [item, secondItem],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "publisherAbuse:getReviewNominationDetail") {
        const nominationId =
          args && typeof args === "object" && "nominationId" in args ? args.nominationId : "";
        const selectedItem = nominationId === secondItem.nomination._id ? secondItem : item;
        return {
          item: selectedItem,
          latestScoreRun: null,
          scoreHistory: [],
          events: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    fireEvent.click(screen.getByText("spammy-pub"));
    expect(screen.getByText("Published skills")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search handle, user, ID, or reason"), {
      target: { value: "second-pub" },
    });

    await waitFor(() => {
      expect(screen.queryByText("Published skills")).toBeNull();
    });
    expect(screen.queryByText("spammy-pub")).toBeNull();
    expect(screen.getByText("second-pub")).toBeTruthy();
  });

  it("shows review nominations as calibration-only", () => {
    const reviewItem = makePublisherAbuseItem({
      handle: "review-pub",
      id: "3",
      label: "review",
      ownerKey: "user:review",
      ownerUserId: "users:review",
      zScore: 1.8,
    });
    useMutationMock.mockImplementation(() => vi.fn(async () => ({ ok: true })));
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [],
          pendingReviewItems: [reviewItem],
          recentResolvedItems: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    fireEvent.click(screen.getByRole("tab", { name: /On the brink/ }));
    fireEvent.click(screen.getByText("review-pub"));

    expect(screen.getByText("Calibration signal")).toBeTruthy();
    expect(screen.getByText(/close to the ban line/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "False positive" })).toBeNull();
  });

  it("shows temporal download/install evidence in the abuse drawer", () => {
    const item = makePublisherAbuseItem({
      handle: "temporal-pub",
      scoreOverrides: {
        modelVersion: "publisher-abuse-temporal.v1",
        reasonCodes: ["temporal_sustained_downloads_flat_installs"],
        temporalBenchmark: {
          sampleSize: 1000,
          downloads30dAverage: 180,
          downloads30dMedian: 45,
          downloads30dP95: 900,
          downloads30dP99: 3000,
          spikeMultiplier7dP95: 4,
          spikeMultiplier7dP99: 12,
        },
        temporalEvidence: [
          {
            skillId: "skills:burst",
            slug: "download-burst",
            displayName: "Download Burst",
            spike: false,
            sustained: true,
            pressure: 18,
            recent7Downloads: 5000,
            recent7Installs: 0,
            previous30Downloads: 120,
            baseline7Downloads: 100,
            spikeMultiplier: 8,
            recent30Downloads: 16_200,
            recent30Installs: 0,
            downloadInstallRatio30: 16_200,
            downloads30dCohortBand: "p99",
            downloads30dVsPeerP95: 18,
            spikeMultiplierVsPeerP95: 2,
            sustainedWindowStartDay: 1,
            sustainedWindowEndDay: 30,
            reasonCodes: ["temporal_sustained_downloads_flat_installs"],
          },
        ],
      },
    });

    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [item],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    fireEvent.click(screen.getByText("temporal-pub"));

    expect(screen.getByText("Temporal signal")).toBeTruthy();
    expect(screen.getByText(/Compared with 1,000 scanned skills/)).toBeTruthy();
    expect(screen.getByText("Download Burst")).toBeTruthy();
    expect(screen.getByText("16,200")).toBeTruthy();
    expect(screen.getByText("Peer 30d P95")).toBeTruthy();
  });

  it("marks the abuse nomination resolved after banning its linked user", async () => {
    const banUser = vi.fn(async () => ({ ok: true }));
    const banPublisherAbuseOwner = vi.fn(async () => ({ ok: true, status: "banned" }));
    const item = makePublisherAbuseItem();
    useMutationMock.mockImplementation((mutation) => {
      const name = getFunctionName(mutation);
      if (name === "users:banUser") return banUser;
      if (name === "publisherAbuse:banPublisherAbuseOwner") return banPublisherAbuseOwner;
      return vi.fn(async () => ({ ok: true }));
    });
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [item],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    fireEvent.click(screen.getByText("spammy-pub"));
    const banReason = screen.getByPlaceholderText("Why are you taking this action? (optional)");
    expect(banReason.getAttribute("maxlength")).toBe("500");
    fireEvent.change(banReason, { target: { value: "confirmed spam" } });
    fireEvent.click(screen.getByRole("button", { name: "Ban user" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Ban user" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(banPublisherAbuseOwner).toHaveBeenCalledWith({
        nominationId: "publisherAbuseReviewNominations:1",
        expectedLatestScoreId: "publisherAbuseScores:1",
        expectedUpdatedAt: 1,
        reason: "confirmed spam",
      });
      expect(banUser).not.toHaveBeenCalled();
    });
  });

  it("disables abuse bans for the current user", () => {
    const item = makePublisherAbuseItem({
      handle: "self-pub",
      ownerKey: "user:admin",
      ownerUserId: "users:admin",
    });
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [item],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    fireEvent.click(screen.getByText("self-pub"));

    expect(screen.getByRole("button", { name: "Ban user" })).toHaveProperty("disabled", true);
  });

  it("disables abuse bans for admin-owned candidates when viewed by moderators", () => {
    authUser = {
      _id: "users:moderator",
      handle: "moderator",
      role: "moderator",
    };
    const item = makePublisherAbuseItem({
      handle: "admin-pub",
      ownerKey: "user:owner-admin",
      ownerRole: "admin",
      ownerUserId: "users:owner-admin",
    });
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [item],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    fireEvent.click(screen.getByText("admin-pub"));

    expect(screen.getByRole("button", { name: "Ban user" })).toHaveProperty("disabled", true);
  });

  it("does not show non-ban resolution controls for potential-ban nominations", () => {
    const banUser = vi.fn(async () => ({ ok: true }));
    const item = makePublisherAbuseItem();
    useMutationMock.mockImplementation((mutation) => {
      const name = getFunctionName(mutation);
      if (name === "users:banUser") return banUser;
      return vi.fn(async () => ({ ok: true }));
    });
    useQueryMock.mockImplementation((query, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "skills:listRecentVersions") return [];
      if (name === "skills:listReportedSkills") return [];
      if (name === "skills:listDuplicateCandidates") return [];
      if (name === "publisherAbuse:listReviewDashboard") {
        return {
          latestRun: null,
          pendingItems: [],
          pendingPotentialBanCandidateItems: [item],
          pendingReviewItems: [],
          recentResolvedItems: [],
        };
      }
      if (name === "users:list") return { items: [], total: 0 };
      return undefined;
    });

    render(<Management />);

    fireEvent.click(screen.getByText("spammy-pub"));

    expect(screen.getByRole("button", { name: "Ban user" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "False positive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Needs discussion" })).toBeNull();
    expect(screen.queryByText(/Non-ban decisions remove/i)).toBeNull();
    expect(banUser).not.toHaveBeenCalled();
  });
});
