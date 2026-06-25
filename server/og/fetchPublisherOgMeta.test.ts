/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const clientCtorMock = vi.fn();

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class ConvexHttpClientMock {
    constructor(url: string) {
      clientCtorMock(url);
    }

    query = queryMock;
  },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: { publishers: { getProfileByHandle: "publishers.getProfileByHandle" } },
}));

describe("fetchPublisherOgMeta", () => {
  beforeEach(() => {
    queryMock.mockReset();
    clientCtorMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("reads downloads from publisher profile stats", async () => {
    queryMock.mockResolvedValue({
      handle: "openclaw",
      kind: "org",
      displayName: "OpenClaw",
      bio: "Build with claws.",
      image: null,
      stats: { downloads: 99, installs: 1200 },
    });

    const { fetchPublisherOgMeta } = await import("./fetchPublisherOgMeta");
    const meta = await fetchPublisherOgMeta("openclaw", "https://example.convex.cloud");

    expect(clientCtorMock).toHaveBeenCalledWith("https://example.convex.cloud");
    expect(queryMock).toHaveBeenCalledWith("publishers.getProfileByHandle", {
      handle: "openclaw",
    });
    expect(meta?.stats.downloads).toBe(99);
  });
});
