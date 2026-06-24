/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPluginOgMeta } from "./fetchPluginOgMeta";

describe("fetchPluginOgMeta", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads downloads from package API stats", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        package: {
          name: "@openclaw/codex",
          displayName: "Codex",
          summary: "OpenClaw Codex harness.",
          latestVersion: "1.0.0",
          stats: { downloads: 99, installs: 1200 },
          verification: { scanStatus: "clean" },
        },
        owner: { handle: "openclaw", image: null },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const meta = await fetchPluginOgMeta("@openclaw/codex", "https://clawhub.ai");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://clawhub.ai/api/v1/packages/%40openclaw%2Fcodex",
      { headers: { Accept: "application/json" } },
    );
    expect(meta?.stats.downloads).toBe(99);
  });
});
