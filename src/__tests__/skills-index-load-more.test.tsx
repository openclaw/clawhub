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

  it("loads the next catalog page only after an explicit click and preserves API order", async () => {
    convexHttpMock.query
      .mockResolvedValueOnce({
        page: [makeListResult("first", "First", 9)],
        hasMore: true,
        nextCursor: "opaque cursor 2",
      })
      .mockResolvedValueOnce({
        page: [makeListResult("second", "Second", 4)],
        hasMore: false,
        nextCursor: null,
      });
    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    expect(convexHttpMock.query).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    expect(convexHttpMock.query).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        cursor: "opaque cursor 2",
        numItems: 20,
      }),
    );
    expect([
      screen.getByTitle("First").textContent,
      screen.getByTitle("Second").textContent,
    ]).toEqual(["First", "Second"]);
  });
});

function makeListResult(slug: string, displayName: string, downloads: number) {
  return {
    skill: {
      _id: `skill_${slug}`,
      slug,
      displayName,
      summary: `${displayName} summary`,
      tags: {},
      stats: { downloads, stars: 0, installs: 0, versions: 1, comments: 0 },
      createdAt: 1,
      updatedAt: 1,
    },
    latestVersion: null,
    ownerHandle: "owner",
  };
}
