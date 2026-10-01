/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as SkillsRoute, SkillsIndex } from "../routes/skills/index";
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
let loaderDataMock: unknown = null;

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
  createFileRoute: () => (config: { component: unknown; validateSearch: unknown }) => ({
    __config: config,
    useLoaderData: () => loaderDataMock,
    useNavigate: () => navigateMock,
    useSearch: () => searchMock,
  }),
  useRouterState: (options: { select: (state: unknown) => unknown }) =>
    options.select({ location: { searchStr: "" } }),
  redirect: (options: unknown) => ({ redirect: options }),
  Link: (props: { children: ReactNode; to?: string }) => (
    <a href={props.to ?? "/"}>{props.children}</a>
  ),
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

describe("category-only skill browse", () => {
  beforeEach(() => {
    resetConvexReactMocks();
    setupDefaultConvexReactMocks();
    navigateMock.mockReset();
    fetchCanonicalTrendingPageMock.mockReset();
    fetchCatalogDiscoveryCapabilitiesMock.mockReset();
    searchMock = {};
    loaderDataMock = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    {},
    { tab: "trending" },
    { tab: "new" },
    { tab: "featured" },
    { tab: "official" },
    { featured: true },
    { highlighted: true },
    { sort: "trending" },
  ])("shows old community skills through retired feed URLs: %j", async (legacy) => {
    const validateSearch = (
      SkillsRoute as unknown as {
        __config: { validateSearch: (s: Record<string, unknown>) => Record<string, unknown> };
      }
    ).__config.validateSearch;
    searchMock = validateSearch({ ...legacy, category: "development", topic: "github" });
    const entry = {
      skill: {
        _id: "skill-old",
        slug: "old-community-skill",
        displayName: "Old Community Skill",
        summary: "GitHub helper",
        categories: ["development"],
        topics: ["github"],
        tags: {},
        stats: { downloads: 3, stars: 0, installs: 0, versions: 1, comments: 0 },
        createdAt: 1,
        updatedAt: 1,
      },
      latestVersion: null,
      ownerHandle: "owner",
    };
    convexHttpMock.query.mockResolvedValue({ page: [entry], hasMore: false, nextCursor: null });
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.getByText("Old Community Skill")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Skill view" })).toBeNull();
    for (const name of ["Featured", "Trending", "Official", "New", "All"])
      expect(screen.queryByRole("radio", { name })).toBeNull();
    const args = convexHttpMock.query.mock.calls.at(-1)?.[1];
    expect(args).toMatchObject({ categorySlug: "development", topic: "github" });
    expect(args.createdAfter).toBeUndefined();
    expect(args.highlightedOnly).toBeUndefined();
    expect(args.officialOnly).toBeUndefined();
    expect(fetchCanonicalTrendingPageMock).not.toHaveBeenCalled();
    expect(fetchCatalogDiscoveryCapabilitiesMock).not.toHaveBeenCalled();
  });

  it("keeps all skill categories available and clears the old category topic on selection", async () => {
    searchMock = { category: "development", topic: "github" };
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.getByLabelText("Skill categories").querySelectorAll("button")).toHaveLength(15);
    fireEvent.click(screen.getByRole("button", { name: "Automation" }));
    expect(navigateMock.mock.calls.at(-1)?.[0].search(searchMock)).toMatchObject({
      category: "automation",
      topic: undefined,
    });
    expect(screen.getByRole("combobox", { name: "Category" })).toBeTruthy();
  });

  it("keeps search visible with no feed tabs or view controls", async () => {
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Grid" })).toBeNull();
    expect(screen.queryByRole("button", { name: "List" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "skill search" }).closest("[hidden]")).toBeNull();
  });
});
