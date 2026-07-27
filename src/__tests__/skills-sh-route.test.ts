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

async function runLoader() {
  const route = await loadRoute();
  try {
    return await route.__config.loader({
      params: { owner: "patrick-erichsen", repo: "skills", slug: "html" },
    });
  } catch (error) {
    return error;
  }
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
