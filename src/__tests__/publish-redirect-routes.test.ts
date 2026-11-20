import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  isRedirect,
  type AnyRoute,
} from "@tanstack/react-router";
import { beforeAll, describe, expect, it } from "vitest";

type LegacyRedirectRoute = AnyRoute & {
  options: {
    beforeLoad: (args: { search: Record<string, string | undefined> }) => never;
    validateSearch: (search: Record<string, unknown>) => Record<string, string | undefined>;
  };
};

async function loadRoute(path: string): Promise<LegacyRedirectRoute> {
  return ((await import(path)) as { Route: LegacyRedirectRoute }).Route;
}

function getRedirectOptions(
  route: LegacyRedirectRoute,
  search: Record<string, string | undefined>,
) {
  try {
    route.options.beforeLoad({ search });
  } catch (error) {
    if (isRedirect(error)) return error.options;
    throw error;
  }
  throw new Error("Expected a redirect");
}

beforeAll(async () => {
  const root = createRootRoute();
  const routes = await Promise.all(
    ["/publish-plugin", "/plugins/new", "/publish-skill", "/upload"].map(async (path) => {
      const route = await loadRoute(`../routes${path}`);
      // Match the file-route metadata supplied by generated routeTree.ts.
      return route.update({ id: path, path, getParentRoute: () => root } as never);
    }),
  );
  createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory() });
});

describe("legacy publish redirects", () => {
  it.each(["/publish-plugin", "/plugins/new"])("redirects %s to /plugins/publish", async (path) => {
    const route = await loadRoute(`../routes${path}`);
    const search = route.options.validateSearch({
      displayName: "Dronzer",
      family: "code-plugin",
      name: "@openclaw/dronzer",
      nextVersion: "1.0.1",
      ownerHandle: "vintageayu",
      sourceRepo: "VintageAyu/dronzer",
      ignored: "drop-me",
    });

    expect(route.id).toBe(path);
    expect(getRedirectOptions(route, search)).toMatchObject({
      to: "/plugins/publish",
      search,
    });
  });

  it.each(["/publish-skill", "/upload"])("redirects %s to /skills/publish", async (path) => {
    const route = await loadRoute(`../routes${path}`);
    const search = route.options.validateSearch({
      updateSlug: "dronzer",
      ownerHandle: "vintageayu",
      ignored: "drop-me",
    });

    expect(route.id).toBe(path);
    expect(search).toEqual({ updateSlug: "dronzer", ownerHandle: "vintageayu" });
    expect(getRedirectOptions(route, search)).toMatchObject({
      to: "/skills/publish",
      search,
    });
  });
});
