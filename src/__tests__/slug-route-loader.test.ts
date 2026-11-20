import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveTopLevelSlugRouteMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({ __config: config }),
  notFound: () => ({ notFound: true }),
  redirect: (options: unknown) => ({ redirect: options }),
}));

vi.mock("../lib/slugRoute", () => ({
  resolveTopLevelSlugRoute: (...args: unknown[]) => resolveTopLevelSlugRouteMock(...args),
}));

async function loadRoute() {
  return (await import("../routes/$slug")).Route as unknown as {
    __config: {
      loader: (args: {
        params: { slug: string };
        abortController: AbortController;
      }) => Promise<unknown>;
      head: (args: { params: { slug: string }; loaderData?: unknown }) => {
        meta?: Array<{ property?: string; name?: string; content: string }>;
      };
    };
  };
}

async function runLoader(slug: string) {
  const route = await loadRoute();
  try {
    return await route.__config.loader({
      params: { slug },
      abortController: new AbortController(),
    });
  } catch (error) {
    return error;
  }
}

describe("top-level slug route loader", () => {
  beforeEach(() => {
    resolveTopLevelSlugRouteMock.mockReset();
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
    vi.stubGlobal("fetch", fetchMock.mockReset());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns not found for plugin aliases without matching publishers", async () => {
    resolveTopLevelSlugRouteMock.mockResolvedValue(null);

    expect(await runLoader("codex")).toEqual({ notFound: true });
  });

  it("returns not found for legacy bare skill slugs", async () => {
    resolveTopLevelSlugRouteMock.mockResolvedValue(null);

    expect(await runLoader("expedia")).toEqual({ notFound: true });
  });

  it("returns publisher profile data for canonical publisher paths", async () => {
    resolveTopLevelSlugRouteMock.mockResolvedValue({
      kind: "publisher",
      handle: "steipete",
      publisher: { _id: "publishers:steipete", handle: "steipete", stats: { skills: 1 } },
    });
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: "success", value: { page: [{ _id: "skills:one" }], isDone: true } }),
    );
    expect(await runLoader("steipete")).toEqual({
      publisher: { _id: "publishers:steipete", handle: "steipete", stats: { skills: 1 } },
      initialCatalog: { tab: "skills", items: [{ _id: "skills:one" }] },
    });
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request.credentials).toBe("omit");
    expect(new Headers(request.headers).has("authorization")).toBe(false);
    expect(JSON.parse(request.body)).toMatchObject({
      path: "publishers:listPublishedPage",
      args: [
        {
          handle: "steipete",
          kind: "skill",
          sort: "downloads",
          paginationOpts: { numItems: 12, cursor: null },
        },
      ],
    });
  });

  it("includes official and affiliation metadata in canonical publisher OG images", async () => {
    const route = await loadRoute();
    const head = route.__config.head({
      params: { slug: "nvidia" },
      loaderData: {
        publisher: {
          _id: "publishers:nvidia",
          handle: "nvidia",
          displayName: "NVIDIA",
          bio: "Official NVIDIA publisher.",
          image: "https://example.com/nvidia.png",
          kind: "org",
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
            downloads: 1200,
          },
        },
      },
    });

    const image = head.meta?.find((item) => item.property === "og:image")?.content ?? "";
    expect(image).toContain("/og/profile?");
    expect(image).toContain("official=1");
    expect(image).toContain("orgState=1");
    expect(image).toContain("orgImages=https%3A%2F%2Fexample.com%2Fopenclaw.png");
  });

  it("returns not found for unknown slugs", async () => {
    resolveTopLevelSlugRouteMock.mockResolvedValue(null);

    expect(await runLoader("missing")).toEqual({ notFound: true });
  });
});
