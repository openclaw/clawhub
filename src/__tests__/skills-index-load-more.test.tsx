/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsIndex } from "../routes/skills/index";
import {
  convexHttpMock,
  convexReactMocks,
  resetConvexReactMocks,
  setupDefaultConvexReactMocks,
} from "./helpers/convexReactMocks";

const navigateMock = vi.fn();
const fetchCanonicalTrendingPageMock = vi.fn();
const fetchCatalogDiscoveryCapabilitiesMock = vi.fn();
let searchMock: Record<string, unknown> = {};

vi.mock("../lib/trendingApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/trendingApi")>();
  return {
    ...original,
    fetchCanonicalTrendingPage: (...args: unknown[]) => fetchCanonicalTrendingPageMock(...args),
  };
});

vi.mock("../lib/catalogDiscoveryCapabilities", () => ({
  fetchCatalogDiscoveryCapabilities: (...args: unknown[]) =>
    fetchCatalogDiscoveryCapabilitiesMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (_config: { component: unknown; validateSearch: unknown }) => ({
    useLoaderData: () => null,
    useNavigate: () => navigateMock,
    useSearch: () => searchMock,
  }),
  useRouterState: (options: { select: (state: unknown) => unknown }) =>
    options.select({ location: { searchStr: "" } }),
  redirect: (options: unknown) => ({ redirect: options }),
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}));

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useAction: (...args: unknown[]) => convexReactMocks.useAction(...args),
  useQuery: (...args: unknown[]) => convexReactMocks.useQuery(...args),
}));

vi.mock("../../src/convex/client", () => ({
  convexHttp: {
    action: (...args: unknown[]) => convexHttpMock.action(...args),
    query: (...args: unknown[]) => convexHttpMock.query(...args),
  },
}));

describe("SkillsIndex load-more observer", () => {
  beforeEach(() => {
    resetConvexReactMocks();
    navigateMock.mockReset();
    searchMock = {};
    setupDefaultConvexReactMocks();
    fetchCanonicalTrendingPageMock.mockReset();
    fetchCatalogDiscoveryCapabilitiesMock.mockReset();
    fetchCatalogDiscoveryCapabilitiesMock.mockResolvedValue({
      apiVersion: 1,
      canonicalTrendingEnabled: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the next canonical page only after an explicit click and preserves API order", async () => {
    fetchCanonicalTrendingPageMock
      .mockResolvedValueOnce({
        kind: "skills",
        snapshotId: "snapshot-1",
        snapshotCursor: "snapshot-cursor",
        generatedAt: "2026-07-26T00:00:00.000Z",
        windowHours: 24,
        rankingVersion: "skills-trending-v1",
        totalItems: 2,
        items: [makeTrendingResult("first", "First", 9)],
        nextCursor: "opaque cursor 2",
      })
      .mockResolvedValueOnce({
        kind: "skills",
        snapshotId: "snapshot-1",
        snapshotCursor: "snapshot-cursor",
        generatedAt: "2026-07-26T00:00:00.000Z",
        windowHours: 24,
        rankingVersion: "skills-trending-v1",
        totalItems: 2,
        items: [makeTrendingResult("second", "Second", 4)],
        nextCursor: null,
      });
    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    expect(fetchCanonicalTrendingPageMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    expect(fetchCanonicalTrendingPageMock).toHaveBeenNthCalledWith(2, {
      cursor: "opaque cursor 2",
      limit: 20,
    });
    expect([
      screen.getByTitle("First").textContent,
      screen.getByTitle("Second").textContent,
    ]).toEqual(["First", "Second"]);
  });
});

function makeTrendingResult(slug: string, displayName: string, installs: number) {
  return {
    id: `clawhub:${slug}`,
    source: "clawhub" as const,
    slug,
    displayName,
    summary: `${displayName} summary`,
    canonicalUrl: `/owner/${slug}`,
    publisher: {
      kind: "user" as const,
      handle: "owner",
      displayName: "Owner",
      image: null,
      official: false,
    },
    official: false,
    featured: false,
    metrics: {
      trending24hInstalls: installs,
      trending24hBookmarks: null,
      lifetimeInstalls: 1000,
      lifetimeInstallsPeriod: "lifetime" as const,
      updatedAt: 1,
    },
  };
}
