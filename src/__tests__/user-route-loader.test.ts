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
      head?: (args: { params: { handle: string }; loaderData?: unknown }) => {
        meta?: Array<{ property?: string; name?: string; content: string }>;
      };
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

  it("includes official and affiliation metadata in legacy publisher OG images", async () => {
    const route = await loadRoute();
    const head = route.__config.head?.({
      params: { handle: "teoslayer" },
      loaderData: {
        publisher: {
          _id: "publishers:teoslayer",
          handle: "teoslayer",
          displayName: "Calin Teodor",
          bio: "Publisher @teoslayer on ClawHub.",
          image: "https://example.com/avatar.png",
          kind: "user",
          official: true,
          affiliations: [
            {
              publisher: {
                displayName: "OpenClaw",
                image: "https://example.com/openclaw.png",
              },
              role: "publisher",
            },
          ],
          stats: {
            downloads: 73878,
          },
        },
      },
    });

    const image = head?.meta?.find((item) => item.property === "og:image")?.content ?? "";
    expect(image).toContain("/og/profile?");
    expect(image).toContain("official=1");
    expect(image).toContain("orgState=1");
    expect(image).toContain("orgImages=https%3A%2F%2Fexample.com%2Fopenclaw.png");
  });
});
