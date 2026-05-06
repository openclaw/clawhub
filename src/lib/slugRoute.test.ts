import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSkillPageDataMock = vi.fn();

vi.mock("./skillPage", () => ({
  fetchSkillPageData: (...args: unknown[]) => fetchSkillPageDataMock(...args),
}));

import { resolveOpenClawPluginSlug, resolveTopLevelSlugRoute } from "./slugRoute";

describe("slug route resolution", () => {
  beforeEach(() => {
    fetchSkillPageDataMock.mockReset();
  });

  it("resolves Codex to the official OpenClaw plugin", async () => {
    await expect(resolveTopLevelSlugRoute("codex")).resolves.toEqual({
      kind: "plugin",
      name: "@openclaw/codex",
      href: "/plugins/@openclaw/codex",
    });
    expect(fetchSkillPageDataMock).not.toHaveBeenCalled();
  });

  it("resolves extension slugs to their configured npm package names", async () => {
    await expect(resolveTopLevelSlugRoute("anthropic")).resolves.toEqual({
      kind: "plugin",
      name: "@openclaw/anthropic-provider",
      href: "/plugins/@openclaw/anthropic-provider",
    });

    await expect(resolveOpenClawPluginSlug("kimi-coding", "openclaw")).resolves.toEqual({
      kind: "plugin",
      name: "@openclaw/kimi-provider",
      href: "/plugins/@openclaw/kimi-provider",
    });

    expect(fetchSkillPageDataMock).not.toHaveBeenCalled();
  });

  it("resolves npm-style OpenClaw scope aliases", async () => {
    await expect(resolveOpenClawPluginSlug("codex", "@openclaw")).resolves.toEqual({
      kind: "plugin",
      name: "@openclaw/codex",
      href: "/plugins/@openclaw/codex",
    });
  });

  it("does not resolve non-OpenClaw owner paths as OpenClaw plugins", async () => {
    await expect(resolveOpenClawPluginSlug("codex", "ivangdavila")).resolves.toBeNull();
  });

  it("falls back to skill slug resolution when no official plugin exists", async () => {
    fetchSkillPageDataMock.mockResolvedValue({
      owner: "steipete",
      initialData: {
        result: {
          resolvedSlug: "weather",
          skill: { slug: "weather" },
          owner: { handle: "steipete" },
        },
      },
    });

    await expect(resolveTopLevelSlugRoute("weather")).resolves.toEqual({
      kind: "skill",
      owner: "steipete",
      slug: "weather",
    });
  });
});
