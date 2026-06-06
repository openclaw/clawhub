import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.VITE_CONVEX_URL = process.env.VITE_CONVEX_URL || "https://example.convex.cloud";

const queryMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: { query: (...args: unknown[]) => queryMock(...args) },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: {
      loader?: (args: { params: { handle: string } }) => Promise<unknown>;
      component?: unknown;
      head?: unknown;
    }) => ({ __config: config }),
  Link: () => null,
  notFound: () => ({ notFound: true }),
}));

async function loadRoute() {
  return (await import("../routes/user/$handle")).Route as unknown as {
    __config: {
      loader?: (args: { params: { handle: string } }) => Promise<unknown>;
    };
  };
}

async function runLoader(handle: string) {
  const route = await loadRoute();
  try {
    return await route.__config.loader?.({ params: { handle } });
  } catch (error) {
    return error;
  }
}

describe("user profile route loader", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
  });

  it("returns not found when the publisher profile query returns null", async () => {
    queryMock.mockResolvedValueOnce(null);

    await expect(runLoader("proof-banned-builder")).resolves.toEqual({ notFound: true });
    expect(queryMock.mock.calls[0]?.[1]).toEqual({ handle: "proof-banned-builder" });
  });

  it("returns the publisher profile for active handles", async () => {
    queryMock.mockResolvedValueOnce({ _id: "publishers:active", handle: "active" });

    await expect(runLoader("active")).resolves.toEqual({
      publisher: { _id: "publishers:active", handle: "active" },
    });
  });
});
