/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSkillOgMeta } from "./fetchSkillOgMeta";

describe("fetchSkillOgMeta", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads downloads from the public skill API stats", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        skill: {
          displayName: "Gifgrep",
          summary: "Search GIFs fast",
          stats: { downloads: 99, installsAllTime: 1200 },
          statsDownloads: 1200,
        },
        owner: { handle: "steipete", image: "https://avatars.githubusercontent.com/u/1?v=4" },
        latestVersion: { version: "1.0.1" },
        moderation: { verdict: "clean", isSuspicious: false, isMalwareBlocked: false },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const meta = await fetchSkillOgMeta("gifgrep", "https://clawhub.ai", "@steipete");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://clawhub.ai/api/v1/skills/gifgrep?ownerHandle=steipete",
      {
        headers: { Accept: "application/json" },
      },
    );
    expect(meta?.stats.downloads).toBe(1200);
  });
});
