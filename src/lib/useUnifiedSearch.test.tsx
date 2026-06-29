/* @vitest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUnifiedSearch } from "./useUnifiedSearch";

const { searchSkillsMock, fetchPluginCatalogMock, convexQueryMock } = vi.hoisted(() => ({
  searchSkillsMock: vi.fn(),
  fetchPluginCatalogMock: vi.fn(),
  convexQueryMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => searchSkillsMock,
}));

vi.mock("./packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
}));

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: (...args: unknown[]) => convexQueryMock(...args),
  },
}));

function makeSkill(slug: string) {
  return {
    skill: {
      _id: `skills:${slug}`,
      slug,
      displayName: slug,
      ownerUserId: "users:owner",
      stats: { downloads: 0, stars: 0 },
      updatedAt: 1,
      createdAt: 1,
    },
    ownerHandle: "owner",
    score: 1,
  };
}

function makePlugin(name: string) {
  return {
    name,
    displayName: name,
    family: "code-plugin",
    channel: "community",
    isOfficial: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeCreator(handle: string) {
  return {
    _id: `publishers:${handle}`,
    _creationTime: 1,
    kind: "org",
    handle,
    displayName: handle,
    image: undefined,
    bio: "Creator profile",
    linkedUserId: undefined,
    official: true,
    stats: {
      skills: 0,
      packages: 0,
      installs: 0,
      downloads: 0,
      stars: 0,
    },
    publishedItems: [],
  };
}

describe("useUnifiedSearch", () => {
  beforeEach(() => {
    searchSkillsMock.mockReset();
    fetchPluginCatalogMock.mockReset();
    convexQueryMock.mockReset();
  });

  it("uses matching loader data without repeating the initial skill search", async () => {
    searchSkillsMock.mockResolvedValue([]);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    convexQueryMock.mockResolvedValue({ page: [], continueCursor: null, isDone: true });

    const initialData = {
      query: "japanese-reading-grader",
      activeType: "all" as const,
      limits: { skills: 25, plugins: 25, creators: 25 },
      skillResults: [
        {
          type: "skill" as const,
          ...makeSkill("japanese-reading-grader"),
        },
      ],
      pluginResults: [],
      creatorResults: [],
      skillHasMore: true,
      pluginHasMore: false,
      creatorHasMore: false,
    };

    const { result } = renderHook(() =>
      useUnifiedSearch("japanese-reading-grader", "all", {
        initialData,
        debounceMs: 0,
        limits: { skills: 25, plugins: 25, creators: 25 },
      }),
    );

    expect(result.current.skillResults.map((entry) => entry.skill.slug)).toEqual([
      "japanese-reading-grader",
    ]);
    expect(result.current.results.map((entry) => entry.type)).toEqual(["skill"]);
    expect(result.current.skillHasMore).toBe(true);

    await waitFor(() => {
      expect(fetchPluginCatalogMock).toHaveBeenCalled();
      expect(convexQueryMock).toHaveBeenCalled();
    });

    expect(searchSkillsMock).not.toHaveBeenCalled();
    expect(result.current.skillHasMore).toBe(true);
  });

  it("requests one extra result and exposes hasMore without inflating counts", async () => {
    searchSkillsMock.mockResolvedValue([makeSkill("one"), makeSkill("two"), makeSkill("three")]);
    fetchPluginCatalogMock.mockResolvedValue({
      items: [makePlugin("one-plugin"), makePlugin("two-plugin"), makePlugin("three-plugin")],
      nextCursor: null,
    });
    convexQueryMock.mockResolvedValue({
      page: [makeCreator("one-creator"), makeCreator("two-creator"), makeCreator("three-creator")],
      continueCursor: null,
      isDone: false,
    });

    const { result } = renderHook(() =>
      useUnifiedSearch("ghost", "all", {
        debounceMs: 0,
        limits: { skills: 2, plugins: 2, creators: 2 },
      }),
    );

    await waitFor(() => {
      expect(result.current.skillCount).toBe(2);
      expect(result.current.pluginCount).toBe(2);
      expect(result.current.creatorCount).toBe(2);
    });

    expect(searchSkillsMock).toHaveBeenCalledWith({
      query: "ghost",
      limit: 3,
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "ghost", limit: 3 }),
    );
    expect(convexQueryMock.mock.calls.at(-1)?.[1]).toEqual({
      query: "ghost",
      paginationOpts: { cursor: null, numItems: 3 },
    });
    expect(result.current.skillResults.map((entry) => entry.skill.slug)).toEqual(["one", "two"]);
    expect(result.current.pluginResults.map((entry) => entry.plugin.name)).toEqual([
      "one-plugin",
      "two-plugin",
    ]);
    expect(result.current.creatorResults.map((entry) => entry.creator.handle)).toEqual([
      "one-creator",
      "two-creator",
    ]);
    expect(result.current.results.map((entry) => entry.type)).toEqual([
      "skill",
      "skill",
      "plugin",
      "plugin",
      "creator",
      "creator",
    ]);
    expect(result.current.skillHasMore).toBe(true);
    expect(result.current.pluginHasMore).toBe(true);
    expect(result.current.creatorHasMore).toBe(true);
  });

  it("caps requested skill and plugin limits at the backend search maximum", async () => {
    searchSkillsMock.mockResolvedValue([]);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    convexQueryMock.mockResolvedValue({ page: [], continueCursor: null, isDone: true });

    renderHook(() =>
      useUnifiedSearch("ghost", "all", {
        debounceMs: 0,
        limits: { skills: 150, plugins: 150, creators: 150 },
      }),
    );

    await waitFor(() => {
      expect(searchSkillsMock).toHaveBeenCalled();
      expect(fetchPluginCatalogMock).toHaveBeenCalled();
      expect(convexQueryMock).toHaveBeenCalled();
    });

    expect(searchSkillsMock).toHaveBeenCalledWith({
      query: "ghost",
      limit: 101,
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "ghost", limit: 101 }),
    );
    expect(convexQueryMock.mock.calls.at(-1)?.[1]).toEqual({
      query: "ghost",
      paginationOpts: { cursor: null, numItems: 50 },
    });
  });

  it("does not leave creator load more stuck after the publisher page cap", async () => {
    searchSkillsMock.mockResolvedValue([]);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    convexQueryMock.mockResolvedValue({
      page: Array.from({ length: 50 }, (_, index) => makeCreator(`creator-${index}`)),
      continueCursor: "next-page",
      isDone: false,
    });

    const { result } = renderHook(() =>
      useUnifiedSearch("ghost", "creators", {
        debounceMs: 0,
        limits: { creators: 150 },
      }),
    );

    await waitFor(() => {
      expect(result.current.creatorCount).toBe(50);
    });

    expect(convexQueryMock.mock.calls.at(-1)?.[1]).toEqual({
      query: "ghost",
      paginationOpts: { cursor: null, numItems: 50 },
    });
    expect(result.current.creatorHasMore).toBe(false);
  });
});
