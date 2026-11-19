import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createRequestHandler, defaultRenderHandler } from "@tanstack/react-router/ssr/server";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenericNotFoundPage } from "../components/GenericNotFoundPage";
import { PackageApiError } from "../lib/packageApi";
import { Route as pluginRoute } from "../routes/$owner/plugins/$slug";
import { Route as templateRoute } from "../routes/$owner/templates/$slug";
import { Route as legacyPackageRoute } from "../routes/packages/$name";
import { Route as legacyPluginRoute } from "../routes/plugins/$name";

const mocks = vi.hoisted(() => ({
  auth: { isLoading: false, isAuthenticated: true },
  revision: 0,
  subscriptions: new Set<() => void>(),
  pending: vi.fn(),
  detail: vi.fn(),
  readme: vi.fn(),
  file: vi.fn(),
  version: vi.fn(),
}));
vi.mock("../lib/useAuthStatus", () => ({ useAuthStatus: () => mocks.auth }));
vi.mock("convex/react", async (importOriginal) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await importOriginal<typeof import("convex/react")>()),
    useConvexAuth: () => mocks.auth,
    useQuery: () => undefined,
    useQueries: (queries: Record<string, { query: FunctionReference<"query">; args: unknown }>) => {
      useSyncExternalStore(
        (listener) => {
          mocks.subscriptions.add(listener);
          return () => {
            mocks.subscriptions.delete(listener);
          };
        },
        () => mocks.revision,
        () => 0,
      );
      return Object.fromEntries(
        Object.entries(queries).map(([key, { query, args }]) => [
          key,
          getFunctionName(query) === "packages:getPendingListingForViewer"
            ? mocks.pending(args)
            : undefined,
        ]),
      );
    },
    useConvex: () => null,
    useMutation: () => vi.fn(),
  };
});
vi.mock("../lib/packageApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/packageApi")>()),
  fetchPackageDetail: mocks.detail,
  fetchPackageReadme: mocks.readme,
  fetchPackageFile: mocks.file,
  fetchPackageVersion: mocks.version,
}));

const pending = {
  name: "@maker/brief",
  displayName: "Private brief",
  summary: "A private summary",
  owner: { handle: "maker", displayName: "Maker Studio", image: null },
  version: "1.2.0",
};

type Kind = "plugin" | "template";
function makeRouter(kind: Kind, isServer = false, suffix = "") {
  const root = createRootRoute({ notFoundComponent: GenericNotFoundPage });
  const path = "/$owner/" + kind + "s/$slug";
  const route = (kind === "plugin" ? pluginRoute : templateRoute).update({
    id: path,
    path,
    getParentRoute: () => root,
  } as never);
  return createRouter({
    isServer,
    routeTree: root.addChildren(
      kind === "plugin"
        ? [
            route,
            legacyPackageRoute.update({
              id: "/packages/$name",
              path: "/packages/$name",
              getParentRoute: () => root,
            } as never),
            legacyPluginRoute.update({
              id: "/plugins/$name",
              path: "/plugins/$name",
              getParentRoute: () => root,
            } as never),
          ]
        : [route],
    ),
    history: createMemoryHistory({ initialEntries: ["/maker/" + kind + "s/brief" + suffix] }),
    defaultPendingMinMs: 0,
  });
}

async function listingRouter(kind: Kind) {
  const router = makeRouter(kind);
  await router.load();
  return router;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.assign(mocks.auth, { isLoading: false, isAuthenticated: true });
  mocks.detail.mockResolvedValue({ package: null, owner: null });
  mocks.file.mockResolvedValue(null);
  mocks.version.mockResolvedValue(null);
  mocks.readme.mockResolvedValue(null);
  mocks.pending.mockReturnValue(pending);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function requestListing(kind: Kind, path: string) {
  return createRequestHandler({
    request: new Request(new URL(path, "http://localhost")),
    createRouter: () => makeRouter(kind, true),
  })(defaultRenderHandler);
}

it("follows legacy package and plugin redirects to a public skill without a private plugin preview", async () => {
  mocks.detail.mockImplementation(async (name: string) =>
    name === "brief"
      ? {
          package: {
            name: "brief",
            displayName: "Published skill",
            summary: "Organize the daily brief.",
            family: "skill",
            latestVersion: "0.9.0",
            tags: {},
            createdAt: 1,
            updatedAt: 2,
          },
          owner: pending.owner,
        }
      : { package: null, owner: null },
  );
  mocks.pending.mockReturnValue({ ...pending, name: "brief" });
  const packages = await requestListing("plugin", "/packages/brief");
  expect(packages.status).toBeGreaterThanOrEqual(300);
  expect(packages.status).toBeLessThan(400);
  const legacy = packages.headers.get("location")!;
  expect(legacy).toBe("/plugins/brief");
  const plugins = await requestListing("plugin", legacy);
  expect(plugins.status).toBeGreaterThanOrEqual(300);
  expect(plugins.status).toBeLessThan(400);
  const canonical = plugins.headers.get("location")!;
  expect(canonical).toBe("/maker/plugins/brief");
  const response = await requestListing("plugin", canonical);
  expect(response.status).toBe(200);
  const page = new DOMParser().parseFromString(await response.text(), "text/html");
  expect(page.querySelector("pre code")?.textContent).toBe("openclaw skills install @maker/brief");
  render(<RouterProvider router={await listingRouter("plugin")} />);
  expect(await screen.findByRole("heading", { name: "Published skill" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy skill install command" })).toBeTruthy();
  expect(screen.queryByText(/is under review/)).toBeNull();
  expect(mocks.pending).not.toHaveBeenCalled();
});

describe.each(["plugin", "template"] as const)("canonical pending %s listing", (kind) => {
  const missing = kind === "plugin" ? "Plugin not found" : "We couldn't find that page.";

  it("never displays the private preview on an unknown subpage", async () => {
    const router = makeRouter(kind, false, "/unknown");
    await router.load();
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: missing })).toBeTruthy();
    expect(mocks.pending).not.toHaveBeenCalled();
  });

  it("keeps a rate-limited registry on its normal error path without trying a private preview", async () => {
    mocks.detail.mockRejectedValue(new PackageApiError("Too many requests", { status: 429 }));
    render(<RouterProvider router={await listingRouter(kind)} />);
    const title =
      kind === "plugin"
        ? "Plugin details are temporarily unavailable"
        : "Could not load this Template";
    expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    expect(mocks.pending).not.toHaveBeenCalled();
  });

  it("sends a no-JS HTTP 404 without a permanent loader or private preview", async () => {
    const response = await requestListing(kind, "/maker/" + kind + "s/brief");
    expect(response.status).toBe(404);
    const html = await response.text();
    // DOMParser parses noscript children as markup (scripting disabled), not inert text.
    const document = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
    const noScript = document.querySelector("noscript");
    expect(noScript?.querySelector("h1, h2, h3")?.textContent).toBe(missing);
    expect(document.querySelector('[aria-busy="true"], [role="status"]')).toBeNull();
    // A scripting-enabled browser must not paint that missing state before auth resolves.
    noScript?.remove();
    expect(document.querySelector("h1, h2, h3")).toBeNull();
    expect(html).not.toMatch(/Private brief|private summary|1\.2\.0|is under review/);
    expect(mocks.pending).not.toHaveBeenCalled();
  });

  it.each(["signed out", "no permission"])(
    "preserves the existing missing page when %s",
    async (viewer) => {
      mocks.auth.isAuthenticated = viewer === "no permission";
      mocks.pending.mockReturnValue(null);
      render(<RouterProvider router={await listingRouter(kind)} />);
      expect(await screen.findByRole("heading", { name: missing })).toBeTruthy();
      expect(screen.queryByText(/under review/)).toBeNull();
      if (viewer === "signed out") expect(mocks.pending).not.toHaveBeenCalled();
    },
  );

  it.each(["authentication", "private lookup"])(
    "does not report missing while resolving %s",
    async (loading) => {
      mocks.auth.isLoading = loading === "authentication";
      mocks.pending.mockReturnValue(undefined);
      render(<RouterProvider router={await listingRouter(kind)} />);
      expect(screen.queryByRole("heading", { name: missing })).toBeNull();
      expect(screen.getByRole("status")).toBeTruthy();
      if (loading === "authentication") expect(mocks.pending).not.toHaveBeenCalled();
    },
  );

  it.each(["publisher", "visitor", "private lookup error"])(
    "keeps an unscoped public release and its install surface for the %s",
    async (viewer) => {
      mocks.auth.isAuthenticated = viewer !== "visitor";
      mocks.detail.mockImplementation(async (name: string) =>
        name !== "brief"
          ? { package: null, owner: null }
          : {
              package: {
                name: "brief",
                displayName: "Public brief",
                summary: "Public summary",
                latestVersion: "0.9.0",
                family: kind === "template" ? "template" : "code-plugin",
                scanStatus: "clean",
                tags: {},
                createdAt: 1,
                updatedAt: 2,
              },
              owner: pending.owner,
            },
      );
      mocks.pending.mockReturnValue(
        viewer === "private lookup error" ? new Error("offline") : { ...pending, name: "brief" },
      );
      mocks.file.mockResolvedValue(
        '---\n{"schemaVersion":1,"agent":{"id":"brief"}}\n---\n# Published instructions',
      );
      mocks.readme.mockResolvedValue("# Published instructions");
      mocks.version.mockResolvedValue({
        version: { version: "0.9.0", files: [], changelog: "Public changelog", createdAt: 1 },
      });
      render(<RouterProvider router={await listingRouter(kind)} />);
      expect(await screen.findByRole("heading", { name: "Public brief" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Published instructions" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /copy.*install command/i })).toBeTruthy();
      expect(screen.queryByText(pending.displayName)).toBeNull();
      expect(screen.queryByText(pending.summary)).toBeNull();
      const notice = screen.queryByText("Version 1.2.0 is under review");
      if (viewer === "publisher") {
        expect(notice).toBeTruthy();
        const publisher = screen.getByRole("link", { name: "View Maker Studio profile" });
        const tabs = screen.getByRole("tablist", {
          name: kind === "plugin" ? "Plugin detail tabs" : "Template contents",
        });
        expect(
          publisher.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
          notice!.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
          notice!.closest(kind === "plugin" ? ".skill-hero-main" : ".template-detail-main"),
        ).not.toBeNull();
      } else expect(notice).toBeNull();
      for (const call of [
        ...mocks.version.mock.calls,
        ...mocks.readme.mock.calls,
        ...mocks.file.mock.calls,
      ]) {
        expect(call).toContain("0.9.0");
      }
    },
  );

  it("opens the ordinary published page when review finishes without retaining private metadata", async () => {
    render(<RouterProvider router={await listingRouter(kind)} />);
    expect(await screen.findByRole("heading", { name: pending.displayName })).toBeTruthy();
    mocks.detail.mockResolvedValue({
      package: {
        name: pending.name,
        displayName: "Approved brief",
        summary: "Approved summary",
        latestVersion: "1.2.0",
        family: kind === "template" ? "template" : "code-plugin",
        tags: {},
        createdAt: 1,
        updatedAt: 2,
      },
      owner: pending.owner,
    });
    mocks.pending.mockReturnValue(null);
    await act(async () => {
      mocks.revision++;
      for (const notify of mocks.subscriptions) notify();
    });
    expect(await screen.findByRole("heading", { name: "Approved brief" })).toBeTruthy();
    expect(screen.queryByText("Version 1.2.0 is under review")).toBeNull();
  });

  it.each(["sign-out", "withdrawal"])("removes an open private preview after %s", async (event) => {
    render(<RouterProvider router={await listingRouter(kind)} />);
    expect(await screen.findByRole("heading", { name: pending.displayName })).toBeTruthy();
    if (event === "sign-out") mocks.auth.isAuthenticated = false;
    else mocks.pending.mockReturnValue(null);
    await act(async () => {
      mocks.revision++;
      for (const notify of mocks.subscriptions) notify();
    });
    expect(await screen.findByRole("heading", { name: missing })).toBeTruthy();
    expect(screen.queryByText(pending.displayName)).toBeNull();
    expect(screen.queryByText(/under review/)).toBeNull();
  });

  it("renders just the authorized first-release preview on a public 404", async () => {
    const router = await listingRouter(kind);
    expect(router.state.matches.at(-1)?.status).toBe("notFound");
    expect(mocks.pending).not.toHaveBeenCalled();
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "Private brief" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View Maker Studio profile" })).toBeTruthy();
    expect(screen.getByText("Version 1.2.0 is under review")).toBeTruthy();
    expect(
      screen.getByText(
        "Only the publisher and ClawHub staff can see this release. Once it’s published, anyone can view and install it.",
      ),
    ).toBeTruthy();
    expect(mocks.pending).toHaveBeenCalledWith({ owner: "maker", slug: "brief", routeKind: kind });
    const tabs = screen.getByRole("tablist", {
      name: kind === "template" ? "Template contents" : "Plugin detail tabs",
    });
    expect(screen.getByRole("status").nextElementSibling?.contains(tabs)).toBe(true);
    const labels =
      kind === "template"
        ? ["CLAW.md", "Skills", "Automations", "Plugins", "Workspace files"]
        : ["README.md", "Versions"];
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(labels);
    for (const label of labels) {
      const tab = within(tabs).getByRole("tab", { name: label });
      fireEvent.click(tab);
      const panel = screen.getByRole("tabpanel", { name: label });
      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(tab.getAttribute("aria-controls")).toBe(panel.id);
      expect(panel.textContent).toBe("Release contents will be available after publication.");
      expect(panel.querySelector("a, button, code")).toBeNull();
    }
    fireEvent.keyDown(within(tabs).getByRole("tab", { selected: true }), { key: "Home" });
    expect(within(tabs).getByRole("tab", { selected: true }).textContent).toBe(labels[0]);
    expect(screen.queryByRole("button", { name: /download|install|add|copy/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /download|install|add/i })).toBeNull();
    expect(mocks.file).not.toHaveBeenCalled();
    expect(mocks.readme).not.toHaveBeenCalled();
    expect(mocks.version).not.toHaveBeenCalled();
  });
});
