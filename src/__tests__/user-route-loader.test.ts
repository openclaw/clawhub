import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.VITE_CONVEX_URL = process.env.VITE_CONVEX_URL || "https://example.convex.cloud";

const queryMock = vi.fn();
const fetchMock = vi.fn();
function catalogResponse(page: unknown[], isDone: boolean) {
  return Response.json({ status: "success", value: { page, isDone } });
}

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
      loader?: (args: {
        params: { handle: string };
        abortController: AbortController;
      }) => Promise<unknown>;
      head?: (args: { params: { handle: string }; loaderData?: unknown }) => {
        meta?: Array<{ property?: string; name?: string; content: string }>;
      };
    };
  };
}

async function runLoader(handle: string, abortController = new AbortController()) {
  const route = await loadRoute();
  try {
    return await route.__config.loader?.({ params: { handle }, abortController });
  } catch (error) {
    return error;
  }
}

describe("user profile route loader", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    vi.stubGlobal("fetch", fetchMock.mockReset());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns not found when the publisher profile query returns null", async () => {
    queryMock.mockResolvedValueOnce(null);

    await expect(runLoader("proof-banned-builder")).resolves.toEqual({ notFound: true });
    expect(queryMock.mock.calls[0]?.[1]).toEqual({ handle: "proof-banned-builder" });
  });

  it("returns the publisher profile for active handles", async () => {
    const publisher = {
      _id: "publishers:active",
      handle: "active",
      stats: { skills: 0, packages: 1 },
    };
    queryMock.mockResolvedValueOnce(publisher);
    fetchMock.mockResolvedValueOnce(catalogResponse([], true));
    await expect(runLoader("active")).resolves.toEqual({
      publisher,
      initialCatalog: { tab: "plugins", items: [] },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body).args[0]).toEqual({
      handle: "active",
      kind: "plugin",
      sort: "downloads",
      paginationOpts: { numItems: 12, cursor: null },
    });
  });

  it("preserves the profile without claiming an empty catalog on an incomplete or failed page", async () => {
    const publisher = { _id: "publishers:active", handle: "active", stats: { skills: 2 } };
    queryMock.mockResolvedValue(publisher);
    fetchMock.mockResolvedValueOnce(catalogResponse([], false));
    await expect(runLoader("active")).resolves.toEqual({ publisher, initialCatalog: null });
    fetchMock.mockRejectedValueOnce(new Error("unavailable"));
    await expect(runLoader("active")).resolves.toEqual({ publisher, initialCatalog: null });
  });

  it("aborts a slow catalog read but returns the profile; aborts navigation without accepting its seed", async () => {
    const publisher = { handle: "active", stats: { skills: 2 } };
    queryMock.mockResolvedValue(publisher);
    fetchMock.mockImplementation(
      (_url, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal!.throwIfAborted();
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        }),
    );
    await expect(runLoader("active")).resolves.toEqual({ publisher, initialCatalog: null });
    expect(fetchMock.mock.calls[0]?.[1].signal.reason.name).toBe("TimeoutError");
    const navigation = new AbortController();
    const pending = runLoader("active", navigation);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    navigation.abort();
    await expect(pending).resolves.toBe(navigation.signal.reason);
    expect(fetchMock.mock.calls[1]?.[1].signal.aborted).toBe(true);
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
