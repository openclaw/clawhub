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

  it("redirects plugin slugs to plugin detail pages", async () => {
    resolveTopLevelSlugRouteMock.mockResolvedValue({
      kind: "plugin",
      name: "@openclaw/codex",
      href: "/plugins/@openclaw/codex",
    });

    expect(await runLoader("codex")).toEqual({
      redirect: {
        href: "/plugins/@openclaw/codex",
        replace: true,
      },
    });
  });

  it("redirects skill slugs to canonical owner pages", async () => {
    resolveTopLevelSlugRouteMock.mockResolvedValue({
      kind: "skill",
      owner: "ivangdavila",
      slug: "codex",
    });

    expect(await runLoader("codex")).toEqual({
      redirect: {
        to: "/$owner/$slug",
        params: { owner: "ivangdavila", slug: "codex" },
        replace: true,
      },
    });
  });

  it("returns not found for unknown slugs", async () => {
    resolveTopLevelSlugRouteMock.mockResolvedValue(null);

    expect(await runLoader("missing")).toEqual({ notFound: true });
  });
});
