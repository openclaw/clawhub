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

  it("enables canonical discovery only when the backend advertises it", async () => {
    convexQueryMock.mockResolvedValue({
      catalogDiscovery: { apiVersion: 2 },
      skillsSh: { runtimeEnabled: true },
    });

    await expect(fetchCatalogDiscoveryCapabilities()).resolves.toEqual({
      apiVersion: 2,
      canonicalTrendingEnabled: true,
    });
  });

  it("preserves the previous catalog discovery contract version", async () => {
    convexQueryMock.mockResolvedValue({
      catalogDiscovery: { apiVersion: 1 },
      skillsSh: { runtimeEnabled: false },
    });

    await expect(fetchCatalogDiscoveryCapabilities()).resolves.toEqual({
      apiVersion: 1,
      canonicalTrendingEnabled: false,
    });
  });

  it("treats a response without catalog discovery capabilities as legacy", async () => {
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
