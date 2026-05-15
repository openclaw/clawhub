/* @vitest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUnifiedSearch } from "./useUnifiedSearch";

const { searchSkillsMock, fetchPluginCatalogMock } = vi.hoisted(() => ({
  searchSkillsMock: vi.fn(),
  fetchPluginCatalogMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => searchSkillsMock,
}));

vi.mock("./packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
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

describe("useUnifiedSearch", () => {
  beforeEach(() => {
    searchSkillsMock.mockReset();
    fetchPluginCatalogMock.mockReset();
  });

  it("requests one extra result and exposes hasMore without inflating counts", async () => {
    searchSkillsMock.mockResolvedValue([makeSkill("one"), makeSkill("two"), makeSkill("three")]);
    fetchPluginCatalogMock.mockResolvedValue({
      items: [makePlugin("one-plugin"), makePlugin("two-plugin"), makePlugin("three-plugin")],
      nextCursor: null,
    });

    const { result } = renderHook(() =>
      useUnifiedSearch("ghost", "all", {
        debounceMs: 0,
        limits: { skills: 2, plugins: 2 },
      }),
    );

    await waitFor(() => {
      expect(result.current.skillCount).toBe(2);
      expect(result.current.pluginCount).toBe(2);
    });

    expect(searchSkillsMock).toHaveBeenCalledWith({
      query: "ghost",
      limit: 3,
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "ghost", limit: 3 }),
    );
    expect(result.current.skillResults.map((entry) => entry.skill.slug)).toEqual(["one", "two"]);
    expect(result.current.pluginResults.map((entry) => entry.plugin.name)).toEqual([
      "one-plugin",
      "two-plugin",
    ]);
    expect(result.current.skillHasMore).toBe(true);
    expect(result.current.pluginHasMore).toBe(true);
  });

  it("caps requested limits at the backend search maximum", async () => {
    searchSkillsMock.mockResolvedValue([]);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });

    renderHook(() =>
      useUnifiedSearch("ghost", "all", {
        debounceMs: 0,
        limits: { skills: 150, plugins: 150 },
      }),
    );

    await waitFor(() => {
      expect(searchSkillsMock).toHaveBeenCalled();
      expect(fetchPluginCatalogMock).toHaveBeenCalled();
    });

    expect(searchSkillsMock).toHaveBeenCalledWith({
      query: "ghost",
      limit: 101,
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "ghost", limit: 101 }),
    );
  });
});
