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

  it("returns not found for unknown slugs", async () => {
    resolveTopLevelSlugRouteMock.mockResolvedValue(null);

    expect(await runLoader("missing")).toEqual({ notFound: true });
  });
});
