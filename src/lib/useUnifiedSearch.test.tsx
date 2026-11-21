/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../__tests__/helpers/deferred";
import { makeCanonicalExternalSearchResult } from "../__tests__/helpers/unifiedSearch";
import { isUnifiedNativeSkillResult, useUnifiedSearch } from "./useUnifiedSearch";

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

function makeCanonicalSkill(slug: string) {
  const native = makeSkill(slug);
  return {
    id: `clawhub:skills:${slug}`,
    source: "clawhub",
    slug,
    displayName: slug,
    summary: null,
    score: 1,
    canonicalUrl: `/owner/${slug}`,
    install: { kind: "clawhub", reference: `owner/${slug}`, sourceUrl: null },
    sourceIdentity: {
      id: `skills:${slug}`,
      owner: "owner",
      repo: null,
      host: null,
      lifetimeInstalls: null,
    },
    metrics: { updatedAt: 1 },
    native,
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

  it("retains native creation time and optional version count beyond the row fields", async () => {
    const source = makeCanonicalSkill("weather");
    searchSkillsMock.mockResolvedValue([
      {
        ...source,
        native: {
          ...source.native,
          skill: { ...source.native.skill, stats: { ...source.native.skill.stats, versions: 3 } },
        },
      },
    ]);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    convexQueryMock.mockResolvedValue({ page: [], isDone: true });
    const { result } = renderHook(() => useUnifiedSearch("weather", { debounceMs: 0 }));
    await waitFor(() => expect(result.current.skillCount).toBe(1));
    const native = result.current.skillResults.find(isUnifiedNativeSkillResult);
    expect(native).toBeDefined();
    if (!native) throw new Error("native skill missing");
    const createdAt: number = native.skill.createdAt;
    const versions: number | undefined = native.skill.stats.versions;
    const icon: string | undefined = native.skill.icon;
    expect(createdAt).toBe(1);
    expect(versions).toBe(3);
    expect(icon).toBeUndefined();
  });

  it("shows ready skill matches while plugin search is still pending", async () => {
    const plugins = deferred<{ items: ReturnType<typeof makePlugin>[]; nextCursor: null }>();
    searchSkillsMock.mockResolvedValue([makeCanonicalSkill("weather")]);
    fetchPluginCatalogMock.mockReturnValue(plugins.promise);
    convexQueryMock.mockResolvedValue({ page: [], isDone: true });

    const { result } = renderHook(() =>
      useUnifiedSearch("weather", { debounceMs: 0, publishPartialResults: true }),
    );
    try {
      await waitFor(() => expect(result.current.skillCount).toBe(1));
      expect(result.current.results.map((entry) => entry.type)).toEqual(["skill"]);
      expect(result.current.isSearching).toBe(true);
    } finally {
      await act(async () => {
        plugins.resolve({ items: [makePlugin("weather")], nextCursor: null });
      });
    }
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.results.map((entry) => entry.type)).toEqual(["plugin", "skill"]);
    expect(searchSkillsMock).toHaveBeenCalledTimes(1);
    expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the default loading boundary until every result type settles", async () => {
    const skills = deferred<ReturnType<typeof makeCanonicalSkill>[]>();
    searchSkillsMock.mockReturnValue(skills.promise);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    convexQueryMock.mockResolvedValue({ page: [makeCreator("weather")], isDone: true });
    const { result } = renderHook(() => useUnifiedSearch("weather", { debounceMs: 0 }));
    await waitFor(() => expect(convexQueryMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(result.current.creatorCount).toBe(0);
    expect(result.current.isSearching).toBe(true);
    await act(async () => skills.resolve([]));
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.creatorCount).toBe(1);
  });

  it("keeps published result ordering until replacement limits settle for the same query", async () => {
    const skills = deferred<ReturnType<typeof makeCanonicalSkill>[]>();
    searchSkillsMock.mockResolvedValueOnce([makeCanonicalSkill("weather")]);
    searchSkillsMock.mockReturnValue(skills.promise);
    fetchPluginCatalogMock.mockResolvedValue({ items: [makePlugin("weather")], nextCursor: null });
    convexQueryMock.mockResolvedValue({ page: [makeCreator("weather")], isDone: true });
    const { result, rerender } = renderHook(
      ({ limit }) =>
        useUnifiedSearch("weather", {
          debounceMs: 0,
          limits: { skills: limit, plugins: limit, creators: limit },
        }),
      { initialProps: { limit: 1 } },
    );
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    const published = result.current.results;
    expect(published.map((entry) => entry.type)).toEqual(["plugin", "skill", "creator"]);

    rerender({ limit: 2 });
    try {
      await waitFor(() => expect(searchSkillsMock).toHaveBeenCalledTimes(2));
      expect(searchSkillsMock).toHaveBeenLastCalledWith({ query: "weather", limit: 3 });
      expect(result.current.isSearching).toBe(true);
      expect(result.current.results).toBe(published);
    } finally {
      await act(async () => skills.resolve([makeCanonicalSkill("replacement")]));
    }
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.results.map((entry) => entry.type)).toEqual([
      "plugin",
      "skill",
      "creator",
    ]);
    expect(result.current.skillResults[0]).toMatchObject({ skill: { slug: "replacement" } });
    expect(result.current.skillCount).toBe(1);
    expect(result.current.pluginCount).toBe(1);
    expect(result.current.creatorCount).toBe(1);
  });

  it("preserves published arrays when a pagination probe changes only hasMore", async () => {
    const probe = deferred<{ items: ReturnType<typeof makePlugin>[]; nextCursor: null }>();
    fetchPluginCatalogMock.mockResolvedValueOnce({
      items: [makePlugin("weather")],
      nextCursor: null,
    });
    fetchPluginCatalogMock.mockReturnValueOnce(probe.promise);
    searchSkillsMock.mockResolvedValue([]);
    convexQueryMock.mockResolvedValue({ page: [], isDone: true });
    const manualCatalogSearch = { query: "weather", consumed: {}, kinds: ["plugin" as const] };
    const { result } = renderHook(() =>
      useUnifiedSearch("weather", {
        debounceMs: 0,
        limits: { plugins: 1 },
        manualCatalogSearch,
      }),
    );
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    const published = result.current.results;
    const plugins = result.current.pluginResults;
    expect(result.current.pluginHasMore).toBe(false);
    try {
      expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () =>
        probe.resolve({ items: [makePlugin("weather"), makePlugin("extra")], nextCursor: null }),
      );
    }
    await waitFor(() => expect(result.current.pluginHasMore).toBe(true));
    expect(result.current.results).toBe(published);
    expect(result.current.pluginResults).toBe(plugins);
    expect(result.current.pluginCount).toBe(1);
  });

  it("clears every published group and count when search is disabled", async () => {
    searchSkillsMock.mockResolvedValue([makeCanonicalSkill("weather")]);
    fetchPluginCatalogMock.mockResolvedValue({ items: [makePlugin("weather")], nextCursor: null });
    convexQueryMock.mockResolvedValue({ page: [makeCreator("weather")], isDone: true });
    const { result, rerender } = renderHook(
      ({ enabled }) => useUnifiedSearch("weather", { debounceMs: 0, enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.results).toHaveLength(3);
    rerender({ enabled: false });
    expect(result.current.results).toEqual([]);
    expect(result.current.skillResults).toEqual([]);
    expect(result.current.pluginResults).toEqual([]);
    expect(result.current.creatorResults).toEqual([]);
    expect(result.current.skillCount).toBe(0);
    expect(result.current.pluginCount).toBe(0);
    expect(result.current.creatorCount).toBe(0);
    expect(result.current.isSearching).toBe(false);
  });

  it("keeps ready matches when another result type fails later", async () => {
    const skills = deferred<ReturnType<typeof makeCanonicalSkill>[]>();
    searchSkillsMock.mockReturnValue(skills.promise);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    convexQueryMock.mockResolvedValue({ page: [makeCreator("weather")], isDone: true });

    const { result } = renderHook(() =>
      useUnifiedSearch("weather", { debounceMs: 0, publishPartialResults: true }),
    );
    try {
      await waitFor(() => expect(result.current.creatorCount).toBe(1));
      expect(result.current.isSearching).toBe(true);
    } finally {
      await act(async () => skills.reject(new Error("Skill search unavailable")));
    }
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.creatorCount).toBe(1);
    expect(result.current.skillSearchError).toBe(true);
    expect(result.current.pluginSearchError).toBe(false);
  });

  it("ignores individual responses from a query that has been replaced", async () => {
    const oldSkills = deferred<ReturnType<typeof makeCanonicalSkill>[]>();
    const oldPlugins = deferred<{ items: ReturnType<typeof makePlugin>[]; nextCursor: null }>();
    searchSkillsMock.mockReturnValueOnce(oldSkills.promise);
    searchSkillsMock.mockResolvedValue([makeCanonicalSkill("new")]);
    fetchPluginCatalogMock.mockReturnValueOnce(oldPlugins.promise);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    convexQueryMock.mockResolvedValue({ page: [], isDone: true });

    const { result, rerender } = renderHook(
      ({ query }) => useUnifiedSearch(query, { debounceMs: 0 }),
      { initialProps: { query: "old" } },
    );
    await waitFor(() => expect(searchSkillsMock).toHaveBeenCalledTimes(1));
    rerender({ query: "new" });
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    await act(async () => {
      oldPlugins.resolve({ items: [makePlugin("old")], nextCursor: null });
    });
    expect(result.current.pluginCount).toBe(0);
    await act(async () => oldSkills.resolve([makeCanonicalSkill("old")]));
    expect(result.current.skillResults).toEqual([
      expect.objectContaining({ skill: expect.objectContaining({ slug: "new" }) }),
    ]);
    expect(result.current.pluginCount).toBe(0);
    expect(result.current.isSearching).toBe(false);
  });

  it("hides the previous query's matches while the next query is pending", async () => {
    const skills = deferred<ReturnType<typeof makeCanonicalSkill>[]>();
    const plugins = deferred<{ items: ReturnType<typeof makePlugin>[]; nextCursor: null }>();
    const creators = deferred<{ page: ReturnType<typeof makeCreator>[]; isDone: true }>();
    searchSkillsMock.mockResolvedValueOnce([makeCanonicalSkill("old")]);
    searchSkillsMock.mockReturnValue(skills.promise);
    fetchPluginCatalogMock.mockResolvedValueOnce({ items: [], nextCursor: null });
    fetchPluginCatalogMock.mockReturnValue(plugins.promise);
    convexQueryMock.mockResolvedValueOnce({ page: [], isDone: true });
    convexQueryMock.mockReturnValue(creators.promise);
    const { result, rerender } = renderHook(
      ({ query }) => useUnifiedSearch(query, { debounceMs: 0 }),
      { initialProps: { query: "old" } },
    );
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.skillCount).toBe(1);
    rerender({ query: "new" });
    try {
      expect(result.current.results).toEqual([]);
      expect(result.current.skillCount).toBe(0);
      expect(result.current.isSearching).toBe(true);
    } finally {
      await act(async () => {
        skills.resolve([]);
        plugins.resolve({ items: [], nextCursor: null });
        creators.resolve({ page: [], isDone: true });
      });
    }
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
      useUnifiedSearch("japanese-reading-grader", {
        initialData,
        debounceMs: 0,
        limits: { skills: 25, plugins: 25, creators: 25 },
      }),
    );

    expect(
      result.current.skillResults
        .filter(isUnifiedNativeSkillResult)
        .map((entry) => entry.skill.slug),
    ).toEqual(["japanese-reading-grader"]);
    expect(result.current.results.map((entry) => entry.type)).toEqual(["skill"]);
    expect(result.current.skillCount).toBe(result.current.skillResults.length);
    expect(result.current.pluginCount).toBe(result.current.pluginResults.length);
    expect(result.current.creatorCount).toBe(result.current.creatorResults.length);
    expect(result.current.skillHasMore).toBe(true);

    await waitFor(() => {
      expect(fetchPluginCatalogMock).toHaveBeenCalled();
      expect(convexQueryMock).toHaveBeenCalled();
    });

    expect(searchSkillsMock).not.toHaveBeenCalled();
    expect(result.current.skillHasMore).toBe(true);
  });

  it.each(["query", "limits"] as const)(
    "fetches current results when loader data has a different %s",
    async (mismatch) => {
      const skills = deferred<ReturnType<typeof makeCanonicalSkill>[]>();
      searchSkillsMock.mockReturnValue(skills.promise);
      fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
      convexQueryMock.mockResolvedValue({ page: [], isDone: true });
      const initialData = {
        query: mismatch === "query" ? "old" : "weather",
        activeType: "all" as const,
        limits: { skills: mismatch === "limits" ? 24 : 25, plugins: 25, creators: 25 },
        skillResults: [{ type: "skill" as const, ...makeSkill("old") }],
        pluginResults: [],
        creatorResults: [],
        skillHasMore: false,
        pluginHasMore: false,
        creatorHasMore: false,
      };
      const { result } = renderHook(() =>
        useUnifiedSearch("weather", { debounceMs: 0, initialData }),
      );
      try {
        expect(result.current.results).toEqual([]);
        expect(result.current.isSearching).toBe(true);
        await waitFor(() =>
          expect(searchSkillsMock).toHaveBeenCalledWith({ query: "weather", limit: 26 }),
        );
      } finally {
        await act(async () => skills.resolve([makeCanonicalSkill("current")]));
      }
      await waitFor(() => expect(result.current.isSearching).toBe(false));
      expect(result.current.skillResults).toEqual([
        expect.objectContaining({ skill: expect.objectContaining({ slug: "current" }) }),
      ]);
    },
  );

  it("still probes creators when every visible result limit is zero", async () => {
    convexQueryMock.mockResolvedValue({ page: [makeCreator("weather")], isDone: true });
    const { result } = renderHook(() =>
      useUnifiedSearch("weather", {
        debounceMs: 0,
        limits: { skills: 0, plugins: 0, creators: 0 },
      }),
    );
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(convexQueryMock).toHaveBeenCalledTimes(1);
    expect(convexQueryMock.mock.calls[0]?.[1]).toEqual({
      query: "weather",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(searchSkillsMock).not.toHaveBeenCalled();
    expect(fetchPluginCatalogMock).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
    expect(result.current.creatorCount).toBe(0);
    expect(result.current.creatorHasMore).toBe(true);
  });

  it("requests one extra result and exposes hasMore without inflating counts", async () => {
    searchSkillsMock.mockResolvedValue([
      makeCanonicalSkill("one"),
      makeCanonicalSkill("two"),
      makeCanonicalSkill("three"),
    ]);
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
      useUnifiedSearch("ghost", {
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
    expect(
      result.current.skillResults
        .filter(isUnifiedNativeSkillResult)
        .map((entry) => entry.skill.slug),
    ).toEqual(["one", "two"]);
    expect(result.current.pluginResults.map((entry) => entry.plugin.name)).toEqual([
      "one-plugin",
      "two-plugin",
    ]);
    expect(result.current.creatorResults.map((entry) => entry.creator.handle)).toEqual([
      "one-creator",
      "two-creator",
    ]);
    expect(result.current.results.map((entry) => entry.type)).toEqual([
      "plugin",
      "plugin",
      "skill",
      "skill",
      "creator",
      "creator",
    ]);
    expect(result.current.skillHasMore).toBe(true);
    expect(result.current.pluginHasMore).toBe(true);
    expect(result.current.creatorHasMore).toBe(true);
  });

  it("preserves canonical native and external result order", async () => {
    searchSkillsMock.mockResolvedValue([
      makeCanonicalSkill("calendar"),
      makeCanonicalExternalSearchResult(),
    ]);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    convexQueryMock.mockResolvedValue({ page: [], continueCursor: null, isDone: true });

    const { result } = renderHook(() =>
      useUnifiedSearch("html", { debounceMs: 0, limits: { skills: 10 } }),
    );

    await waitFor(() => expect(result.current.skillCount).toBe(2));

    expect(result.current.skillResults.map((entry) => entry.type)).toEqual(["skill", "skills-sh"]);
    expect(result.current.skillResults[1]).toMatchObject({
      type: "skills-sh",
      result: {
        externalId: "patrick-erichsen/skills/html",
        reference: "skills-sh:patrick-erichsen/skills/html",
      },
    });
  });

  it("caps requested skill and plugin limits at the backend search maximum", async () => {
    searchSkillsMock.mockResolvedValue([]);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    convexQueryMock.mockResolvedValue({ page: [], continueCursor: null, isDone: true });

    renderHook(() =>
      useUnifiedSearch("ghost", {
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
      useUnifiedSearch("ghost", {
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
