import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.VITE_CONVEX_URL = process.env.VITE_CONVEX_URL ?? "https://example.convex.cloud";

const queryMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({ __config: config }),
  notFound: () => ({ notFound: true }),
  redirect: (options: unknown) => ({ redirect: options }),
}));

vi.mock("../convex/client", () => ({
  convexHttp: { query: (...args: unknown[]) => queryMock(...args) },
}));

async function loadRoute() {
  return (await import("../routes/skills-sh/$owner/$repo/$slug")).Route as unknown as {
    __config: {
      loader: (args: { params: { owner: string; repo: string; slug: string } }) => Promise<unknown>;
    };
  };
}

async function runLoader(params = { owner: "patrick-erichsen", repo: "skills", slug: "html" }) {
  const route = await loadRoute();
  try {
    return await route.__config.loader({ params });
  } catch (error) {
    return error;
  }
}

async function getFuzzyMatchParams() {
  const { createMemoryHistory, createRootRoute, createRoute, createRouter } =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  const rootRoute = createRootRoute();
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/skills-sh/$owner/$repo/$slug",
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const match = router
    .matchRoutes("/skills-sh/patrick-erichsen/skills/html/extra")
    .find((candidate) => candidate.routeId === "/skills-sh/$owner/$repo/$slug");
  if (!match) throw new Error("Expected TanStack Router to fuzzy-match the skills.sh detail route");
  return match.params;
}

describe("skills.sh detail route", () => {
  beforeEach(() => queryMock.mockReset());

  it("returns the stored external detail payload", async () => {
    const entry = { displayName: "HTML Artifact Chooser" };
    queryMock.mockResolvedValue({ kind: "external", entry });

    expect(await runLoader()).toEqual(entry);
    expect(queryMock.mock.calls[0]?.[1]).toEqual({
      owner: "patrick-erichsen",
      repo: "skills",
      slug: "html",
    });
  });

  it("omits TanStack fuzzy-match metadata from the Convex query", async () => {
    const entry = { displayName: "HTML Artifact Chooser" };
    queryMock.mockResolvedValue({ kind: "external", entry });
    const params = await getFuzzyMatchParams();

    expect(params).toEqual({
      owner: "patrick-erichsen",
      repo: "skills",
      slug: "html",
    });
    expect(await runLoader(params)).toEqual(entry);
    expect(queryMock.mock.calls[0]?.[1]).toEqual({
      owner: "patrick-erichsen",
      repo: "skills",
      slug: "html",
    });
  });

  it("redirects a promoted alias to its canonical publisher route", async () => {
    queryMock.mockResolvedValue({
      kind: "redirect",
      canonicalRoute: "/openclaw/skills/html",
      canonicalRef: "@openclaw/html",
    });

    expect(await runLoader()).toEqual({ redirect: { href: "/openclaw/skills/html" } });
  });

  it("returns not found for a hidden or unknown mirror row", async () => {
    queryMock.mockResolvedValue(null);

    expect(await runLoader()).toEqual({ notFound: true });
  });
});
