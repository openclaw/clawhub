import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveTopLevelSlugRouteMock = vi.fn();

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
      loader: (args: { params: { slug: string } }) => Promise<unknown>;
      head: (args: { params: { slug: string }; loaderData?: unknown }) => {
        meta?: Array<{ property?: string; name?: string; content: string }>;
      };
    };
  };
}

async function runLoader(slug: string) {
  const route = await loadRoute();
  try {
    return await route.__config.loader({ params: { slug } });
  } catch (error) {
    return error;
  }
}

describe("top-level slug route loader", () => {
  beforeEach(() => {
    resolveTopLevelSlugRouteMock.mockReset();
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
      publisher: { _id: "publishers:steipete", handle: "steipete" },
    });

    expect(await runLoader("steipete")).toEqual({
      publisher: { _id: "publishers:steipete", handle: "steipete" },
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
