import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSkillPageDataMock = vi.fn();
const queryMock = vi.fn();

vi.mock("./skillPage", () => ({
  fetchSkillPageData: (...args: unknown[]) => fetchSkillPageDataMock(...args),
}));

vi.mock("../convex/client", () => ({
  convexHttp: { query: (...args: unknown[]) => queryMock(...args) },
}));

import { resolveOpenClawPluginSlug, resolveTopLevelSlugRoute } from "./slugRoute";

describe("slug route resolution", () => {
  beforeEach(() => {
    fetchSkillPageDataMock.mockReset();
    queryMock.mockReset();
  });

  it("resolves Codex to the official OpenClaw plugin", async () => {
    await expect(resolveTopLevelSlugRoute("codex")).resolves.toEqual({
      kind: "plugin",
      name: "@openclaw/codex",
      href: "/openclaw/plugins/codex",
    });
    expect(fetchSkillPageDataMock).not.toHaveBeenCalled();
  });

  it("resolves extension slugs to their configured npm package names", async () => {
    await expect(resolveTopLevelSlugRoute("anthropic")).resolves.toEqual({
      kind: "plugin",
      name: "@openclaw/anthropic-provider",
      href: "/openclaw/plugins/anthropic-provider",
    });

    await expect(resolveOpenClawPluginSlug("kimi-coding", "openclaw")).resolves.toEqual({
      kind: "plugin",
      name: "@openclaw/kimi-provider",
      href: "/openclaw/plugins/kimi-provider",
    });

    await expect(resolveTopLevelSlugRoute("diffs-language-pack")).resolves.toEqual({
      kind: "plugin",
      name: "@openclaw/diffs-language-pack",
      href: "/openclaw/plugins/diffs-language-pack",
    });

    expect(fetchSkillPageDataMock).not.toHaveBeenCalled();
  });

  it("resolves npm-style OpenClaw scope aliases", async () => {
    await expect(resolveOpenClawPluginSlug("codex", "@openclaw")).resolves.toEqual({
      kind: "plugin",
      name: "@openclaw/codex",
      href: "/openclaw/plugins/codex",
    });
  });

  it("does not resolve non-OpenClaw owner paths as OpenClaw plugins", async () => {
    await expect(resolveOpenClawPluginSlug("codex", "ivangdavila")).resolves.toBeNull();
  });

  it("falls back to skill slug resolution when no official plugin exists", async () => {
    queryMock.mockResolvedValue(null);
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

  it("resolves publisher handles before legacy bare skill slugs", async () => {
    queryMock.mockResolvedValue({ _id: "publishers:steipete", handle: "steipete" });

    await expect(resolveTopLevelSlugRoute("steipete")).resolves.toEqual({
      kind: "publisher",
      handle: "steipete",
      publisher: { _id: "publishers:steipete", handle: "steipete" },
    });
    expect(fetchSkillPageDataMock).not.toHaveBeenCalled();
  });

  it("resolves publisher handles before OpenClaw plugin aliases", async () => {
    queryMock.mockResolvedValue({ _id: "publishers:tencent", handle: "tencent", kind: "org" });

    await expect(resolveTopLevelSlugRoute("tencent")).resolves.toEqual({
      kind: "publisher",
      handle: "tencent",
      publisher: { _id: "publishers:tencent", handle: "tencent", kind: "org" },
    });
    expect(fetchSkillPageDataMock).not.toHaveBeenCalled();
  });

  it("keeps OpenClaw plugin aliases available when no publisher handle exists", async () => {
    queryMock.mockResolvedValue(null);

    await expect(resolveTopLevelSlugRoute("tencent")).resolves.toEqual({
      kind: "plugin",
      name: "@openclaw/tencent-provider",
      href: "/openclaw/plugins/tencent-provider",
    });
    expect(fetchSkillPageDataMock).not.toHaveBeenCalled();
  });
});
