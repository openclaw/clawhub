import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((options: unknown) => ({ redirect: options }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: unknown) => ({ __config: config, __path: path }),
  redirect: (options: unknown) => redirectMock(options),
}));

type LegacyRedirectRoute = {
  __config: {
    beforeLoad: (args: { search: Record<string, string | undefined> }) => never;
    validateSearch: (search: Record<string, unknown>) => Record<string, string | undefined>;
  };
  __path: string;
};

async function loadRoute(path: string): Promise<LegacyRedirectRoute> {
  return ((await import(path)) as { Route: LegacyRedirectRoute }).Route;
}

describe("legacy publish redirects", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("redirects legacy plugin publish links to /plugins/publish", async () => {
    const route = await loadRoute("../routes/publish-plugin");
    const search = route.__config.validateSearch({
      displayName: "Dronzer",
      family: "code-plugin",
      name: "@openclaw/dronzer",
      nextVersion: "1.0.1",
      ownerHandle: "vintageayu",
      sourceRepo: "VintageAyu/dronzer",
      ignored: "drop-me",
    });

    expect(route.__path).toBe("/publish-plugin");
    expect(() => route.__config.beforeLoad({ search })).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({
      to: "/plugins/publish",
      search,
    });
  });

  it("redirects legacy skill publish links to /skills/publish", async () => {
    const route = await loadRoute("../routes/publish-skill");
    const search = route.__config.validateSearch({
      updateSlug: "dronzer",
      ownerHandle: "openclaw",
      ignored: "drop-me",
    });

    expect(route.__path).toBe("/publish-skill");
    expect(search).toEqual({ updateSlug: "dronzer", ownerHandle: "openclaw" });
    expect(() => route.__config.beforeLoad({ search })).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({
      to: "/skills/publish",
      search,
    });
  });
});
