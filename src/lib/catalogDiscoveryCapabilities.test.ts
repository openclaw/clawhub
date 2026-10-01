import { beforeEach, describe, expect, it, vi } from "vitest";

const convexQueryMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: { query: (...args: unknown[]) => convexQueryMock(...args) },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    rolloutCapabilities: {
      getPublicCapabilities: "rolloutCapabilities:getPublicCapabilities",
    },
  },
}));

import { fetchCatalogDiscoveryCapabilities } from "./catalogDiscoveryCapabilities";

describe("fetchCatalogDiscoveryCapabilities", () => {
  beforeEach(() => {
    convexQueryMock.mockReset();
  });

  it("enables canonical Trending independently of the skills.sh rollout", async () => {
    convexQueryMock.mockResolvedValue({
      catalogDiscovery: { apiVersion: 1, canonicalTrendingEnabled: true },
      skillsSh: { runtimeEnabled: false },
    });

    await expect(fetchCatalogDiscoveryCapabilities()).resolves.toEqual({
      apiVersion: 1,
      canonicalTrendingEnabled: true,
    });
  });

  it("treats the previous response shape as a legacy backend", async () => {
    convexQueryMock.mockResolvedValue({
      skillsSh: { runtimeEnabled: false },
    });

    await expect(fetchCatalogDiscoveryCapabilities()).resolves.toEqual({
      apiVersion: 0,
      canonicalTrendingEnabled: false,
    });
  });

  it("falls back conservatively when the capabilities query is unavailable", async () => {
    convexQueryMock.mockRejectedValue(new Error("Could not find public function"));

    await expect(fetchCatalogDiscoveryCapabilities()).resolves.toEqual({
      apiVersion: 0,
      canonicalTrendingEnabled: false,
    });
  });
});
