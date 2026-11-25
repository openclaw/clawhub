/* @vitest-environment jsdom */

import { createRequire } from "node:module";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchPackageDetail,
  fetchPackageFile,
  fetchPackageReadme,
  fetchPackageVersion,
  fetchPackageVersions,
  type PackageDetailResponse,
  type PackageVersionDetail,
} from "../lib/packageApi";
import { setViewportWidth } from "./helpers/viewport";

const isRateLimitedPackageApiErrorMock = vi.fn(
  (error: unknown) =>
    typeof error === "object" && error !== null && (error as { status?: number }).status === 429,
);
const useQueryMock = vi.fn();
const useQueriesMock = vi.fn();
const useMutationMock = vi.fn();
const convexQueryMock = vi.fn();
const convexClientMock = { query: convexQueryMock };
const useAuthStatusMock = vi.fn();
const routerInvalidateMock = vi.fn();
let pathnameMock = "/plugins/demo-plugin";

type PluginDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  versions: Awaited<ReturnType<typeof fetchPackageVersions>> | null | undefined;
  readme: string | null;
  rateLimited: {
    scope: "detail" | "metadata";
    retryAfterSeconds: number | null;
  } | null;
};

const emptyVersions = { items: [], nextCursor: null };

let paramsMock = { name: "demo-plugin" };
let loaderDataMock: PluginDetailLoaderData = {
  detail: {
    package: {
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin" as const,
      channel: "community" as const,
      isOfficial: false,
      summary: "Demo summary",
      latestVersion: null,
      createdAt: 1,
      updatedAt: 1,
      tags: {},
      compatibility: null,
      verification: null,
    },
    owner: null,
  },
  version: null,
  versions: emptyVersions,
  readme: null as string | null,
  rateLimited: null,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { loader?: unknown; head?: unknown; component?: unknown }) => ({
    __config: config,
    useParams: () => paramsMock,
    useLoaderData: () => loaderDataMock,
  }),
  useRouterState: ({
    select,
  }: {
    select?: (state: { location: { pathname: string } }) => string;
  }) => (select ? select({ location: { pathname: pathnameMock } }) : pathnameMock),
  useRouter: () => ({ invalidate: routerInvalidateMock }),
  redirect: (options: unknown) => ({ redirect: options }),
  Outlet: () => <div data-testid="nested-plugin-route" />,
  Link: ({
    children,
    to,
    ...props
  }: {
    children?: ReactNode;
    to?: string;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof to === "string" ? to : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    query = convexQueryMock;
  },
  useConvex: () => convexClientMock,
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useQueries: (queries: Record<string, { query: unknown; args: unknown }>) =>
    useQueriesMock(queries),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../lib/packageApi", () => ({
  fetchPackageDetail: vi.fn(),
  fetchPackageFile: vi.fn(),
  fetchPackageReadme: vi.fn(),
  fetchPackageVersion: vi.fn(),
  fetchPackageVersions: vi.fn(),
  isRateLimitedPackageApiError: (error: unknown) => isRateLimitedPackageApiErrorMock(error),
  getPackageArtifactDownloadPath: vi.fn(
    (name: string, version: string) =>
      `/api/v1/packages/${name}/versions/${version}/artifact/download`,
  ),
  getPackageDownloadPath: vi.fn((name: string, version?: string | null) =>
    version
      ? `/api/v1/packages/${name}/download?version=${version}`
      : `/api/v1/packages/${name}/download`,
  ),
}));

vi.mock("../components/MarkdownPreview", () => ({
  MarkdownPreview: ({
    children,
  }: {
    children: string;
    className?: string;
    highlight?: boolean;
  }) => <div>{children}</div>,
}));

async function loadRoute() {
  return (await import("../routes/plugins/$name")).Route as unknown as {
    __config: {
      loader?: ({ params }: { params: { name: string } }) => Promise<PluginDetailLoaderData>;
      component?: ComponentType;
    };
  };
}

function getInstallCard() {
  return within(screen.getByRole("complementary")).getByRole("article", { name: "Install" });
}

function openVersions(name: string | RegExp = /^View releases?\b/) {
  const metadata = screen.getByRole("group", { name: "Plugin metadata" });
  fireEvent.click(within(metadata).getByRole("button", { name }));
  const dialog = screen.getByRole("dialog", { name: "Release details" });
  expect(within(dialog).getByRole("tab", { name: "Versions", selected: true })).toBeTruthy();
  return dialog;
}

function openActivity() {
  const dialog = openVersions();
  fireEvent.click(within(dialog).getByRole("tab", { name: "Activity" }));
  return dialog;
}

function closeDialog() {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Close/i }));
}

function openRelease(version: string) {
  fireEvent.click(screen.getByRole("button", { name: `Show changelog for v${version}` }));
}

describe("plugin detail route", () => {
  beforeEach(() => {
    setViewportWidth(1071);
    paramsMock = { name: "demo-plugin" };
    pathnameMock = "/plugins/demo-plugin";
    window.history.replaceState(null, "", pathnameMock);
    vi.mocked(fetchPackageDetail).mockReset();
    vi.mocked(fetchPackageFile).mockReset();
    vi.mocked(fetchPackageReadme).mockReset();
    vi.mocked(fetchPackageVersion).mockReset();
    vi.mocked(fetchPackageVersions).mockReset();
    vi.mocked(fetchPackageVersions).mockResolvedValue(emptyVersions);
    vi.mocked(fetchPackageFile).mockResolvedValue("# Bundled Skill");
    loaderDataMock = {
      detail: {
        package: {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          summary: "Demo summary",
          latestVersion: null,
          createdAt: 1,
          updatedAt: 1,
          tags: {},
          compatibility: null,
          verification: null,
        },
        owner: null,
      },
      version: null,
      versions: emptyVersions,
      readme: null,
      rateLimited: null,
    };
    isRateLimitedPackageApiErrorMock.mockClear();
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue(undefined);
    useQueriesMock.mockReset();
    // Match Convex's query-keyed results, including Error values, while keeping
    // the existing per-query fixture implementations and assertions intact.
    useQueriesMock.mockImplementation(
      (queries: Record<string, { query: unknown; args: unknown }>) =>
        Object.fromEntries(
          Object.entries(queries).map(([key, { query, args }]) => {
            try {
              return [key, useQueryMock(query, args)];
            } catch (error) {
              return [key, error instanceof Error ? error : new Error(String(error))];
            }
          }),
        ),
    );
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn());
    convexQueryMock.mockReset();
    convexQueryMock.mockResolvedValue(null);
    useAuthStatusMock.mockReset();
    routerInvalidateMock.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows CLI first and a Desktop action inline for published plugins", async () => {
    loaderDataMock.detail.package = {
      ...loaderDataMock.detail.package!,
      name: "@owner/scoped-plugin",
      latestVersion: "1.0.0",
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const card = getInstallCard();
    expect(screen.queryByRole("dialog")).toBeNull();
    const options = within(card).getByRole("group", { name: "Install option" });
    expect(
      within(options)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["CLI", "Desktop"]);
    expect(within(card).getByRole("button", { name: "CLI", pressed: true })).toBeTruthy();
    expect(within(card).queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Desktop" }));
    expect(
      within(card).getByRole("link", { name: "Install in OpenClaw" }).getAttribute("href"),
    ).toBe("openclaw://plugins/install?name=%40owner%2Fscoped-plugin");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders one inline install card, the README, and a release button in the metadata rail", async () => {
    loaderDataMock.detail.package!.latestVersion = "1.0.0";
    loaderDataMock.readme = "Getting started with Demo";
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    render(<Component />);

    const heading = screen.getByRole("heading", { level: 1, name: "Demo Plugin" });
    const hero = heading.closest<HTMLElement>(".catalog-detail__hero");
    expect(hero?.closest(".catalog-detail")).toBeTruthy();
    expect(within(hero!).queryByRole("button", { name: /^(?:Add|Install)$/i })).toBeNull();
    expect(within(hero!).queryByRole("link", { name: /^(?:Add|Install|Download)$/i })).toBeNull();
    expect(screen.getAllByRole("article", { name: "Install" })).toEqual([getInstallCard()]);
    expect(screen.queryByText("Package details")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("Getting started with Demo")).toBeTruthy();
    const rail = within(screen.getByRole("complementary"));
    const metadata = within(rail.getByRole("group", { name: "Plugin metadata" }));
    expect(metadata.getByRole("button", { name: "View release 1.0.0" }).textContent).toBe("1.0.0");
    const dialog = openVersions("View release 1.0.0");
    expect(within(dialog).getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
      "/api/v1/packages/demo-plugin/download?version=1.0.0",
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    { family: "bundle-plugin", name: "discord", href: "openclaw://plugins/install?name=discord" },
    {
      family: "code-plugin",
      name: "owner/plugin",
      href: "openclaw://plugins/install?name=owner%2Fplugin",
    },
  ] as const)(
    "preserves the exact published $family name $name in the Mac link",
    async ({ family, name, href }) => {
      loaderDataMock.detail.package = {
        ...loaderDataMock.detail.package!,
        family,
        name,
        latestVersion: "1.0.0",
      };
      const route = await loadRoute();
      const Component = route.__config.component as ComponentType;
      render(<Component />);
      const card = getInstallCard();
      fireEvent.click(within(card).getByRole("button", { name: "Desktop" }));
      expect(
        within(card).getByRole("link", { name: "Install in OpenClaw" }).getAttribute("href"),
      ).toBe(href);
    },
  );

  it.each(["unpublished", "beta-only", "skill", "malicious package", "malicious release"] as const)(
    "does not offer a Mac launch for a %s",
    async (state) => {
      loaderDataMock.detail.package = {
        ...loaderDataMock.detail.package!,
        latestVersion: state === "unpublished" || state === "beta-only" ? null : "1.0.0",
        family: state === "skill" ? "skill" : "code-plugin",
        scanStatus: state === "malicious package" ? "malicious" : "clean",
      };
      if (state === "beta-only") {
        loaderDataMock.version = {
          package: null,
          version: { version: "1.1.0-beta.1", createdAt: 1, changelog: "", files: [] },
        };
      }
      if (state === "malicious release") {
        loaderDataMock.version = {
          package: null,
          version: {
            version: "1.0.0",
            createdAt: 1,
            changelog: "",
            files: [],
            verification: {
              tier: "source-linked",
              scope: "artifact-only",
              scanStatus: "malicious",
            },
          },
        };
      }
      const route = await loadRoute();
      const Component = route.__config.component as ComponentType;
      render(<Component />);
      if (state !== "skill") {
        const releaseButton =
          state === "unpublished"
            ? "View releases"
            : state === "beta-only"
              ? "View release 1.1.0-beta.1"
              : "View release 1.0.0";
        const dialog = openVersions(releaseButton);
        expect(within(dialog).queryByRole("link", { name: "Download" })).toBeNull();
        closeDialog();
      }
      if (state === "malicious package" || state === "malicious release") {
        expect(screen.getByText("Download blocked")).toBeTruthy();
        expect(screen.queryByRole("article", { name: "Install" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
        expect(screen.queryByRole("button", { name: /Copy plugin install/ })).toBeNull();
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
        return;
      }
      const card = getInstallCard();
      expect(within(card).queryByRole("button", { name: "Desktop" })).toBeNull();
      expect(within(card).queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
      expect(within(card).getByRole("button", { name: "CLI", pressed: true })).toBeTruthy();
      fireEvent.click(within(card).getByRole("button", { name: "Prompt" }));
      expect(within(card).getByRole("button", { name: "Prompt", pressed: true })).toBeTruthy();
    },
  );

  it.each([
    { family: "code-plugin", name: "demo-plugin", target: "demo-plugin@latest" },
    { family: "code-plugin", name: "discord", target: "discord@latest" },
    { family: "code-plugin", name: "@shopify/ai-toolkit", target: "@shopify/ai-toolkit" },
    { family: "code-plugin", name: "@sliekens/voxtral", target: "@sliekens/voxtral" },
    { family: "code-plugin", name: "owner/plugin", target: "owner/plugin" },
    { family: "bundle-plugin", name: "demo-bundle", target: "demo-bundle@latest" },
    { family: "bundle-plugin", name: "@owner/scoped-bundle", target: "@owner/scoped-bundle" },
  ] as const)(
    "shows and copies the exact CLI command for $name",
    async ({ family, name, target }) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      loaderDataMock.detail.package = { ...loaderDataMock.detail.package!, family, name };
      const route = await loadRoute();
      const Component = route.__config.component as ComponentType;

      render(<Component />);

      const card = getInstallCard();
      fireEvent.click(within(card).getByRole("button", { name: "CLI" }));
      const command = `openclaw plugins install clawhub:${target}`;
      expect(card.querySelector("pre")?.textContent).toBe(command);
      expect(within(card).getByRole("button", { name: "CLI" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      fireEvent.click(within(card).getByRole("button", { name: "Copy plugin install command" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(command));
    },
  );

  it.each([488, 1280])("preserves the skill command at viewport width %i", async (width) => {
    setViewportWidth(width);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    loaderDataMock.detail.package = {
      ...loaderDataMock.detail.package!,
      family: "skill",
      name: "demo-skill",
    };
    loaderDataMock.detail.owner = { handle: "@demo-owner", displayName: "Demo Owner", image: null };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const card = getInstallCard();
    const command = "openclaw skills install @demo-owner/demo-skill";
    expect(card.querySelector("pre")?.textContent).toBe(command);
    fireEvent.click(within(card).getByRole("button", { name: "Copy skill install command" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(command));
  });

  it("expands and collapses the inline README without opening release details", async () => {
    // jsdom does not lay out text. Give the README a measured height larger than its clamp.
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(560);
    loaderDataMock.readme = Array.from({ length: 120 }, (_, i) => "README line " + i).join("\n");
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    render(<Component />);

    expect(screen.getByRole("heading", { name: /readme/i })).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    const toggle = screen.getByRole("button", { name: /read more|show more/i, expanded: false });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /less/i, expanded: true }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides download actions when the plugin has no latest release", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(
      within(openVersions("View releases")).queryByRole("link", { name: "Download" }),
    ).toBeNull();
  });

  it("keeps browse links for canonical topics and categories in plugin metadata", async () => {
    loaderDataMock.detail.package = {
      ...loaderDataMock.detail.package!,
      topics: ["Web Search", "Research"],
      categories: ["tools", "web", "channels"],
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    render(<Component />);

    const metadata = within(screen.getByLabelText("Plugin metadata"));
    for (const category of ["Tools", "Web", "Channels"]) {
      expect(
        metadata.getByRole("link", { name: `View ${category} plugins` }).getAttribute("href"),
      ).toBe(`/plugins?category=${category.toLowerCase()}`);
    }
    for (const topic of ["web-search", "research"]) {
      expect(
        metadata.getByRole("link", { name: new RegExp(topic, "i") }).getAttribute("href"),
      ).toContain(topic);
    }
  });

  it("renders populated active release history on the versions tab", async () => {
    const publishedAt = new Date("2026-06-01T12:00:00Z").getTime();
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "2.0.0",
        },
        owner: null,
      },
      versions: {
        items: [
          {
            version: "2.0.0",
            createdAt: publishedAt,
            changelog: "Adds package release history.",
            distTags: ["latest", "stable"],
          },
          {
            version: "2.0.0-beta.1",
            createdAt: publishedAt - 86_400_000,
            changelog: "Previews package release history.",
            distTags: ["beta"],
          },
        ],
        nextCursor: null,
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    openVersions();

    expect(screen.getAllByText("v2.0.0").length).toBeGreaterThan(0);
    expect(screen.getByText(new Date(publishedAt).toLocaleDateString())).toBeTruthy();
    openRelease("2.0.0");
    expect(screen.getByText("Adds package release history.")).toBeTruthy();
    openRelease("2.0.0-beta.1");
    expect(screen.getByText("Previews package release history.")).toBeTruthy();
    expect(screen.getByText("latest")).toBeTruthy();
    expect(screen.getByText("stable")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(
      document.querySelector(
        'a[href="/api/v1/packages/demo-plugin/download?version=2.0.0-beta.1"]',
      ),
    ).toBeNull();
    expect(screen.queryByText("Download .zip")).toBeNull();
  });

  it("defers the first release-history request until Versions opens", async () => {
    loaderDataMock = { ...loaderDataMock, versions: undefined };
    vi.mocked(fetchPackageVersions).mockResolvedValueOnce({
      items: [
        {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Loaded on demand",
          distTags: ["latest"],
        },
      ],
      nextCursor: null,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(fetchPackageVersions).not.toHaveBeenCalled();
    openVersions();

    await waitFor(() => expect(fetchPackageVersions).toHaveBeenCalledTimes(1));
    expect(fetchPackageVersions).toHaveBeenCalledWith("demo-plugin", {
      limit: 20,
      signal: expect.any(AbortSignal),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Show changelog for v1.0.0" }));
    expect(await screen.findByText("Loaded on demand")).toBeTruthy();
  });

  it("retries an unavailable first release-history request", async () => {
    loaderDataMock = { ...loaderDataMock, versions: undefined };
    vi.mocked(fetchPackageVersions)
      .mockRejectedValueOnce(new Error("versions unavailable"))
      .mockResolvedValueOnce(emptyVersions);
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    openVersions();

    expect(await screen.findByText("Release history is temporarily unavailable.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No active releases are available.")).toBeTruthy();
    expect(fetchPackageVersions).toHaveBeenCalledTimes(2);
  });

  it("aborts and discards a stale first release-history request after navigation", async () => {
    let resolveFirstPage!: (page: Awaited<ReturnType<typeof fetchPackageVersions>>) => void;
    const firstPage = new Promise<Awaited<ReturnType<typeof fetchPackageVersions>>>((resolve) => {
      resolveFirstPage = resolve;
    });
    loaderDataMock = { ...loaderDataMock, versions: undefined };
    vi.mocked(fetchPackageVersions)
      .mockReturnValueOnce(firstPage)
      .mockResolvedValueOnce({
        items: [
          {
            version: "2.0.0",
            createdAt: 2,
            changelog: "Second plugin release",
            distTags: ["latest"],
          },
        ],
        nextCursor: null,
      });
    const { PluginDetailPage } = await import("../routes/plugins/$name");
    const { rerender } = render(
      <PluginDetailPage name="demo-plugin" loaderData={loaderDataMock} />,
    );
    openVersions();
    await waitFor(() => expect(fetchPackageVersions).toHaveBeenCalledTimes(1));
    const firstSignal = vi.mocked(fetchPackageVersions).mock.calls[0]?.[1]?.signal;

    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          name: "second-plugin",
          displayName: "Second Plugin",
        },
        owner: null,
      },
      versions: undefined,
    };
    window.location.hash = "#versions";
    rerender(<PluginDetailPage name="second-plugin" loaderData={loaderDataMock} />);

    await waitFor(() => expect(fetchPackageVersions).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      resolveFirstPage({
        items: [
          {
            version: "1.0.0",
            createdAt: 1,
            changelog: "Stale first plugin release",
            distTags: [],
          },
        ],
        nextCursor: null,
      });
    });

    openRelease("2.0.0");
    expect(screen.getByText("Second plugin release")).toBeTruthy();
    expect(screen.queryByText("Stale first plugin release")).toBeNull();
  });

  it("does not load untrusted remote package or manifest icons in the catalog header", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          icon: "https://cdn.example.test/icons/package.svg",
        },
        owner: null,
      },
      version: {
        package: {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
        },
        version: {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Adds a manifest icon",
          files: [],
          pluginManifestSummary: {
            schemaVersion: 1,
            icon: "https://cdn.example.test/icons/manifest.svg",
            configFields: [],
            mcpServers: [],
            bundledSkills: [],
          },
        },
      },
    };
    const { PluginDetailPage } = await import("../routes/plugins/$name");

    const { container } = render(
      <PluginDetailPage name="demo-plugin" loaderData={loaderDataMock} />,
    );

    const hero = container.querySelector(".catalog-detail__hero");
    expect(hero).toBeTruthy();
    expect(hero?.querySelector('img[src$="/package.svg"], img[src$="/manifest.svg"]')).toBeNull();
  });

  it("loads and appends the next active release page", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      versions: {
        items: [
          {
            version: "2.0.0",
            createdAt: 2,
            changelog: "Current page",
            distTags: ["latest"],
          },
        ],
        nextCursor: "versions:next",
      },
    };
    vi.mocked(fetchPackageVersions).mockResolvedValueOnce({
      items: [
        {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Loaded next page",
          distTags: [],
        },
      ],
      nextCursor: null,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    openVersions();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    expect(fetchPackageVersions).toHaveBeenCalledWith("demo-plugin", {
      cursor: "versions:next",
      limit: 20,
      signal: expect.any(AbortSignal),
    });
    openRelease("2.0.0");
    expect(screen.getByText("Current page")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Show changelog for v1.0.0" }));
    expect(screen.getByText("Loaded next page")).toBeTruthy();
    expect(
      document.querySelector('a[href="/api/v1/packages/demo-plugin/download?version=1.0.0"]'),
    ).toBeNull();
    expect(screen.queryByText("Download .zip")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));
    expect(screen.getByRole("button", { name: /changelog for v1\.0\.0$/ })).toBeTruthy();
    expect(fetchPackageVersions).toHaveBeenCalledTimes(1);
  });

  it("resets shared detail state when the resolved package changes", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          name: "@scope/plugin-a",
          displayName: "Plugin A",
        },
        owner: null,
      },
      readme: "Plugin A README",
      versions: {
        items: [
          {
            version: "2.0.0",
            createdAt: 2,
            changelog: "Plugin A current release",
            distTags: ["latest"],
          },
        ],
        nextCursor: "versions:next",
      },
    };
    vi.mocked(fetchPackageVersions).mockResolvedValueOnce({
      items: [
        {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Plugin A loaded release",
          distTags: [],
        },
      ],
      nextCursor: null,
    });
    const { PluginDetailPage } = await import("../routes/plugins/$name");
    const { rerender } = render(
      <PluginDetailPage name="shared-plugin" loaderData={loaderDataMock} />,
    );
    openVersions();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });
    openRelease("1.0.0");
    expect(screen.getByText("Plugin A loaded release")).toBeTruthy();

    window.history.pushState(null, "", "/plugins/@scope/plugin-b");
    pathnameMock = "/plugins/@scope/plugin-b";
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          name: "@scope/plugin-b",
          displayName: "Plugin B",
        },
        owner: null,
      },
      readme: "Plugin B README",
      versions: {
        items: [
          {
            version: "3.0.0",
            createdAt: 3,
            changelog: "Plugin B release",
            distTags: ["latest"],
          },
        ],
        nextCursor: null,
      },
    };
    rerender(<PluginDetailPage name="shared-plugin" loaderData={loaderDataMock} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Plugin B README")).toBeTruthy();
    expect(screen.queryByText("Plugin A loaded release")).toBeNull();

    openVersions();

    openRelease("3.0.0");
    expect(screen.getByText("Plugin B release")).toBeTruthy();
    expect(screen.queryByText("Plugin A loaded release")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(fetchPackageVersions).toHaveBeenCalledTimes(1);
  });

  it("does not hide a remaining release cursor when the current page is empty", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      versions: {
        items: [],
        nextCursor: "versions:next",
      },
    };
    vi.mocked(fetchPackageVersions).mockResolvedValueOnce({
      items: [
        {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Loaded after empty page",
          distTags: [],
        },
      ],
      nextCursor: null,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    openVersions();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    openRelease("1.0.0");
    expect(screen.getByText("Loaded after empty page")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("renders bundled manifest capabilities and lazy-loads skill previews", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          name: "example-ai-plugin",
          displayName: "Example AI Plugin",
          latestVersion: "1.2.3",
        },
        owner: null,
      },
      version: {
        package: {
          name: "example-ai-plugin",
          displayName: "Example AI Plugin",
          family: "code-plugin",
        },
        version: {
          version: "1.2.3",
          createdAt: 1,
          changelog: "demo",
          distTags: ["latest"],
          files: [],
          compatibility: { pluginApiRange: "^1.0.0" },
          verification: null,
          artifact: null,
          pluginManifestSummary: {
            schemaVersion: 1,
            compatibility: { pluginApiRange: "^2.0.0" },
            configFields: [
              {
                name: "EXAMPLE_PLUGIN_API_KEY",
                description: "API key used to connect to the example service.",
                required: true,
                sensitive: true,
              },
              {
                name: "EXAMPLE_PLUGIN_MODEL",
                description: "Optional model override.",
                required: false,
                sensitive: false,
              },
            ],
            mcpServers: [
              {
                name: "exampleMcp",
                url: "https://mcp.example.test",
                auth: "oauth",
                transport: "streamable-http",
              },
            ],
            bundledSkills: [
              {
                name: "research",
                description: "Deep research assistant.",
                rootPath: "skills/research",
                skillMdPath: "skills/research/SKILL.md",
                sha256: "a".repeat(64),
                size: 128,
              },
            ],
          },
        },
      },
    };
    vi.mocked(fetchPackageFile).mockResolvedValueOnce(
      [
        "---",
        "name: research",
        "description: Collect and verify source material.",
        "---",
        "# Research",
        "",
        "Compare the original sources before summarizing.",
      ].join("\n"),
    );
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("heading", { name: /skills/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /MCP servers?/i })).toBeTruthy();
    const summary = screen
      .getByText("exampleMcp", { selector: "summary, summary *" })
      .closest("summary")!;
    const disclosure = summary.closest("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(summary);
    expect(disclosure.open).toBe(true);
    expect(within(disclosure).getByText("https://mcp.example.test")).toBeTruthy();
    expect(within(disclosure).getByText("OAuth")).toBeTruthy();
    expect(within(disclosure).getByText("streamable-http")).toBeTruthy();

    const dialog = openVersions();
    expect(
      within(within(dialog).getByRole("tablist", { name: "Plugin detail tabs" }))
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Activity", "Configuration", "Compatibility", "Versions"]);
    fireEvent.click(within(dialog).getByRole("tab", { name: "Compatibility" }));
    expect(screen.getByText("OpenClaw plugin API")).toBeTruthy();
    expect(screen.getByText("^2.0.0")).toBeTruthy();
    expect(screen.queryByText("EXAMPLE_PLUGIN_API_KEY")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Configuration" }));
    expect(screen.getByText("EXAMPLE_PLUGIN_API_KEY")).toBeTruthy();
    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.getByText("Sensitive")).toBeTruthy();

    closeDialog();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Deep research assistant.")).toBeTruthy();
    expect(fetchPackageFile).not.toHaveBeenCalled();

    const skillRow = screen.getByRole("button", { name: "Preview research" });
    expect(skillRow.tagName).toBe("BUTTON");
    fireEvent.click(skillRow);

    await waitFor(() => {
      expect(fetchPackageFile).toHaveBeenCalledWith(
        "example-ai-plugin",
        "skills/research/SKILL.md",
        "1.2.3",
      );
    });
    const preview = screen.getByRole("dialog", { name: "research" });
    expect(
      await within(preview).findByText(/Compare the original sources before summarizing/),
    ).toBeTruthy();
    expect(preview.textContent).toContain("# Research");
    expect(preview.textContent).not.toContain("name: research");
    expect(preview.textContent).not.toContain("Collect and verify source material.");
  });

  it("keeps loaded releases and allows retry when loading more fails", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      versions: {
        items: [
          {
            version: "2.0.0",
            createdAt: 2,
            changelog: "Current page",
            distTags: ["latest"],
          },
        ],
        nextCursor: "versions:next",
      },
    };
    vi.mocked(fetchPackageVersions)
      .mockRejectedValueOnce(new Error("versions unavailable"))
      .mockResolvedValueOnce({
        items: [
          {
            version: "1.0.0",
            createdAt: 1,
            changelog: "Loaded after retry",
            distTags: [],
          },
        ],
        nextCursor: null,
      });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    openVersions();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    openRelease("2.0.0");
    expect(screen.getByText("Current page")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load more releases. Try again.",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    expect(fetchPackageVersions).toHaveBeenLastCalledWith("demo-plugin", {
      cursor: "versions:next",
      limit: 20,
      signal: expect.any(AbortSignal),
    });
    openRelease("1.0.0");
    expect(screen.getByText("Loaded after retry")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a pending release page after navigating to another plugin", async () => {
    let resolvePendingPage!: (page: Awaited<ReturnType<typeof fetchPackageVersions>>) => void;
    const pendingPage = new Promise<Awaited<ReturnType<typeof fetchPackageVersions>>>((resolve) => {
      resolvePendingPage = resolve;
    });
    loaderDataMock = {
      ...loaderDataMock,
      versions: {
        items: [
          {
            version: "2.0.0",
            createdAt: 2,
            changelog: "First plugin release",
            distTags: ["latest"],
          },
        ],
        nextCursor: "versions:next",
      },
    };
    vi.mocked(fetchPackageVersions).mockReturnValueOnce(pendingPage);
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    const { rerender } = render(<Component />);
    openVersions();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          name: "second-plugin",
          displayName: "Second Plugin",
        },
        owner: null,
      },
      versions: {
        items: [
          {
            version: "3.0.0",
            createdAt: 3,
            changelog: "Second plugin release",
            distTags: ["latest"],
          },
        ],
        nextCursor: null,
      },
    };
    paramsMock = { name: "second-plugin" };
    pathnameMock = "/plugins/second-plugin";
    rerender(<Component />);

    await act(async () => {
      resolvePendingPage({
        items: [
          {
            version: "1.0.0",
            createdAt: 1,
            changelog: "Stale first plugin release",
            distTags: [],
          },
        ],
        nextCursor: null,
      });
    });

    openRelease("3.0.0");
    expect(screen.getByText("Second plugin release")).toBeTruthy();
    expect(screen.queryByText("Stale first plugin release")).toBeNull();
  });

  it.each(["Activity", "Configuration", "Compatibility"])(
    "opens release details directly on the %s hash without loading versions",
    async (tab) => {
      loaderDataMock.version = {
        package: null,
        version: {
          version: "1.0.0",
          createdAt: 1,
          changelog: "First release",
          files: [],
          pluginManifestSummary: {
            schemaVersion: 1,
            compatibility: { pluginApiRange: "^2.0.0" },
            configFields: [{ name: "MODEL", required: false, sensitive: false }],
            bundledSkills: [],
            mcpServers: [],
          },
        },
      };
      loaderDataMock.versions = undefined;
      window.history.replaceState(null, "", "#" + tab.toLowerCase());
      const route = await loadRoute();
      const Component = route.__config.component as ComponentType;
      render(<Component />);
      const dialog = await screen.findByRole("dialog", { name: "Release details" });
      expect(within(dialog).getByRole("tab", { name: tab, selected: true })).toBeTruthy();
      expect(fetchPackageVersions).not.toHaveBeenCalled();
      closeDialog();
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("opens release history in release details from the versions hash", async () => {
    window.location.hash = "#versions";
    loaderDataMock = {
      ...loaderDataMock,
      versions: undefined,
    };
    vi.mocked(fetchPackageVersions).mockResolvedValueOnce({
      items: [
        {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Initial release",
          distTags: ["latest"],
        },
      ],
      nextCursor: null,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    const dialog = await screen.findByRole("dialog", { name: "Release details" });
    expect(within(dialog).getByRole("tab", { name: "Versions", selected: true })).toBeTruthy();
    await within(dialog).findByRole("button", { name: "Show changelog for v1.0.0" });
    expect(fetchPackageVersions).toHaveBeenCalledTimes(1);
    openRelease("1.0.0");
    expect(screen.getByText("Initial release")).toBeTruthy();
  });

  it("keeps the first render on README when the URL hash targets versions", async () => {
    window.location.hash = "#versions";
    loaderDataMock = {
      ...loaderDataMock,
      versions: {
        items: [
          {
            version: "1.0.0",
            createdAt: 1,
            changelog: "Initial release",
            distTags: ["latest"],
          },
        ],
        nextCursor: null,
      },
      readme: "SSR README",
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    const { renderToString } = createRequire(`${process.cwd()}/package.json`)(
      "react-dom/server",
    ) as {
      renderToString: (node: ReactNode) => string;
    };

    const html = renderToString(<Component />);

    expect(html).toContain("SSR README");
    expect(html).not.toContain("Initial release");
  });

  it("keeps the versions tab available for empty active release histories", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    openVersions();

    expect(screen.getByText("No active releases are available.")).toBeTruthy();
  });

  it("distinguishes unavailable release history from an empty history", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      versions: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    openVersions();

    expect(screen.getByText("Release history is temporarily unavailable.")).toBeTruthy();
    expect(screen.queryByText("No active releases are available.")).toBeNull();
  });

  it("links the publisher byline to the canonical owner profile", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: loaderDataMock.detail.package,
        owner: { handle: "openclaw", displayName: "OpenClaw", image: null },
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    const publisher = screen.getByRole("link", { name: /openclaw/i });
    expect(publisher.closest(".catalog-detail__publisher")).toBeTruthy();
    expect(publisher.getAttribute("href")).toBe("/openclaw");
  });

  it("uses Plugins and the display name for scoped package breadcrumbs", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          name: "@openclaw/firecrawl-plugin",
          displayName: "OpenClaw Firecrawl Plugin",
        },
        owner: { handle: "openclaw", displayName: "OpenClaw", image: null },
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumb).getByRole("link", { name: "Plugins" }).getAttribute("href")).toBe(
      "/plugins",
    );
    expect(within(breadcrumb).getByText("OpenClaw Firecrawl Plugin")).toBeTruthy();
    expect(within(breadcrumb).queryByRole("link", { name: /^openclaw$/i })).toBeNull();
  });

  it("labels official packages as Official", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          channel: "official",
          isOfficial: true,
        },
        owner: { handle: "openclaw", displayName: "OpenClaw", image: null },
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    const { container } = render(<Component />);
    const publisher = container.querySelector<HTMLElement>(".catalog-detail__publisher");
    expect(publisher).toBeTruthy();
    expect(within(publisher!).getByLabelText("Official")).toBeTruthy();
  });

  it("renders plugin activity skeletons while graphs load", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "1.0.0",
          stats: { downloads: 1_234, installs: 9, stars: 0, versions: 1 },
        },
        owner: null,
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    render(<Component />);
    const dialog = openActivity();
    expect(within(dialog).getByRole("tab", { name: "Activity", selected: true })).toBeTruthy();
    expect(within(dialog).queryByText("30-day Installs")).toBeNull();
    expect(dialog.querySelectorAll(".metric-trend-card-skeleton")).toHaveLength(1);
    expect(screen.queryByRole("img", { name: "Daily installs over the last 30 days" })).toBeNull();
  });

  it("renders the plugin 30-day downloads graph from a deferred activity query", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "1.0.0",
          stats: { downloads: 1_234, installs: 9, stars: 0, versions: 1 },
        },
        owner: {
          handle: "demo-owner",
          displayName: "Demo Owner",
          image: null,
        },
      },
    };
    convexQueryMock.mockResolvedValueOnce({
      downloads: {
        range: "daily",
        days: 30,
        total: 14,
        points: [
          { day: 20_451, value: 2 },
          { day: 20_452, value: 1 },
          { day: 20_453, value: 0 },
          { day: 20_454, value: 5 },
          { day: 20_455, value: 3 },
          { day: 20_456, value: 0 },
          { day: 20_457, value: 3 },
        ],
      },
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const rail = within(screen.getByLabelText("Plugin metadata"));
    expect(rail.getByText("Downloads")).toBeTruthy();
    expect(rail.queryByText("Code Plugin")).toBeNull();
    expect(rail.queryByRole("img", { name: "Daily downloads over the last 30 days" })).toBeNull();
    const activity = within(openActivity());
    expect(activity.getByText(/code plugin/i)).toBeTruthy();
    expect(
      await activity.findByRole("img", { name: "Daily downloads over the last 30 days" }),
    ).toBeTruthy();
    expect(activity.getByText("14")).toBeTruthy();
    expect(screen.queryByText("30-day Installs")).toBeNull();
    expect(screen.queryByRole("img", { name: "Daily installs over the last 30 days" })).toBeNull();
    expect(screen.getByRole("img", { name: "Daily downloads over the last 30 days" })).toBeTruthy();
    expect(
      convexQueryMock.mock.calls.some(([query, args]) => {
        return (
          getFunctionName(query as never) === "packages:getActivityTrendForName" &&
          typeof args === "object" &&
          args !== null &&
          "name" in args &&
          args.name === "demo-plugin" &&
          "endDay" in args &&
          typeof args.endDay === "number"
        );
      }),
    ).toBe(true);
    expect(
      useQueryMock.mock.calls.some(
        ([query]) => getFunctionName(query as never) === "packages:getActivityTrendForName",
      ),
    ).toBe(false);
  });

  it("falls back to all-time plugin stats when activity graphs are unavailable", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "1.0.0",
          stats: { downloads: 1_234, installs: 9, stars: 0, versions: 1 },
        },
        owner: null,
      },
    };
    convexQueryMock.mockResolvedValueOnce(null);
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    render(<Component />);
    const metadata = screen.getByLabelText("Plugin metadata");
    const dialog = openActivity();
    await waitFor(() => expect(dialog.querySelector(".metric-trend-card-skeleton")).toBeNull());
    expect(within(dialog).getByText("1.2k")).toBeTruthy();
    expect(
      within(dialog).queryByRole("img", { name: "Daily downloads over the last 30 days" }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("img", { name: "Daily installs over the last 30 days" }),
    ).toBeNull();
    expect(within(dialog).getByRole("link", { name: "Download" })).toBeTruthy();
    closeDialog();
    expect(within(metadata).getByText("Downloads")).toBeTruthy();
    expect(within(metadata).queryByRole("link", { name: "Download" })).toBeNull();
  });

  it("shows plugin settings when the viewer can manage the plugin", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", role: "moderator" },
    });
    useQueryMock.mockReturnValue({
      package: { _id: "packages:1", name: "demo-plugin", displayName: "Demo Plugin" },
      latestRelease: { _id: "packageReleases:1" },
    });
    loaderDataMock = {
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "1.0.0",
        },
        owner: { handle: "demo-owner", displayName: "Demo Owner", image: null },
      },
      version: {
        package: {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
        },
        version: {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Initial release",
          distTags: ["latest"],
          files: [],
          compatibility: null,
          verification: null,
          sha256hash: null,
          llmAnalysis: null,
        },
      },
      versions: emptyVersions,
      readme: null,
      rateLimited: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const newVersionLink = screen.getByRole("link", { name: "New version" });
    expect(within(openVersions()).getByRole("link", { name: "Download" })).toBeTruthy();
    closeDialog();
    expect(newVersionLink.getAttribute("href")).toBe(
      "/plugins/publish?ownerHandle=demo-owner&name=demo-plugin&displayName=Demo+Plugin",
    );
    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      name: "demo-plugin",
      candidateNames: ["@openclaw/demo-plugin", "demo-plugin"],
    });
  });

  it.each([true, false])(
    "keeps inspector failure as an explicit Error value without changing management permission (%s)",
    async (canManage) => {
      const error = new Error("Function execution timed out (maximum duration: 1s)");
      useAuthStatusMock.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
        me: { _id: "users:viewer", role: "user" },
      });
      useQueryMock.mockImplementation((query: unknown) => {
        const name = getFunctionName(query as never);
        if (name === "packages:getPackageInspectorValidationSummaryPublic") throw error;
        if (name === "packages:getManageContext") {
          return canManage
            ? {
                package: {
                  _id: "packages:1",
                  name: "demo-plugin",
                  displayName: "Demo Plugin",
                },
                latestRelease: { _id: "packageReleases:1", version: "1.0.0" },
              }
            : null;
        }
        return undefined;
      });
      const route = await loadRoute();
      const Component = route.__config.component as ComponentType;
      render(<Component />);

      expect(screen.getByRole("heading", { name: /^Demo Plugin$/ })).toBeTruthy();
      expect(screen.getByText(/Compatibility details are temporarily unavailable/)).toBeTruthy();
      expect(screen.queryByText("Something went wrong")).toBeNull();
      expect(Boolean(screen.queryByRole("link", { name: "New version" }))).toBe(canManage);
      expect(useQueriesMock).toHaveBeenCalledWith({
        validationSummary: {
          query: expect.anything(),
          args: { name: "demo-plugin" },
        },
      });
      expect(
        useQueriesMock.mock.results.some(
          (result) => result.type === "return" && result.value.validationSummary === error,
        ),
      ).toBe(true);
    },
  );

  it("hides plugin settings when the viewer cannot manage the plugin", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", role: "user" },
    });
    useQueryMock.mockReturnValue(null);
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("link", { name: "New version" })).toBeNull();
    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
  });

  it("lets plugin owners delete a non-latest release and invalidates route metadata", async () => {
    const deleteOwnedRelease = vi.fn().mockResolvedValue({ ok: true });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "packages:deleteOwnedRelease" ? deleteOwnedRelease : vi.fn(),
    );
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:owner", role: "user" },
    });
    useQueryMock.mockImplementation((query: unknown) => {
      const name = getFunctionName(query as never);
      if (name === "packages:getManageContext") {
        return {
          package: { _id: "packages:1", name: "demo-plugin", displayName: "Demo Plugin" },
          latestRelease: { _id: "packageReleases:latest", version: "2.0.0" },
        };
      }
      if (name === "packages:canDeleteVersions") return true;
      return null;
    });
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "2.0.0",
        },
        owner: { handle: "demo-owner", displayName: "Demo Owner", image: null },
      },
      versions: {
        items: [
          {
            version: "2.0.0",
            createdAt: 2,
            changelog: "Current plugin release",
            distTags: ["latest"],
          },
          {
            version: "1.0.0",
            createdAt: 1,
            changelog: "Older plugin release",
            distTags: [],
          },
        ],
        nextCursor: null,
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    expect(
      useQueryMock.mock.calls
        .filter(([query]) => getFunctionName(query as never) === "packages:canDeleteVersions")
        .at(-1)?.[1],
    ).toBe("skip");
    openVersions();
    await waitFor(() =>
      expect(
        useQueryMock.mock.calls.some(
          ([query, args]) =>
            getFunctionName(query as never) === "packages:canDeleteVersions" && args !== "skip",
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete version 1.0.0" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete version" }));

    await waitFor(() => {
      expect(deleteOwnedRelease).toHaveBeenCalledWith({
        name: "demo-plugin",
        version: "1.0.0",
      });
      expect(screen.queryByText("Older plugin release")).toBeNull();
      expect(routerInvalidateMock).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps plugin Delete hidden from staff-only managers", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:moderator", role: "moderator" },
    });
    useQueryMock.mockImplementation((query: unknown) => {
      const name = getFunctionName(query as never);
      if (name === "packages:getManageContext") {
        return {
          package: { _id: "packages:1", name: "demo-plugin", displayName: "Demo Plugin" },
          latestRelease: { _id: "packageReleases:latest", version: "2.0.0" },
        };
      }
      if (name === "packages:canDeleteVersions") return false;
      return null;
    });
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "2.0.0",
        },
        owner: { handle: "demo-owner", displayName: "Demo Owner", image: null },
      },
      versions: {
        items: [
          {
            version: "2.0.0",
            createdAt: 2,
            changelog: "Current plugin release",
            distTags: ["latest"],
          },
          {
            version: "1.0.0",
            createdAt: 1,
            changelog: "Older plugin release",
            distTags: [],
          },
        ],
        nextCursor: null,
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    expect(screen.getByRole("link", { name: "New version" })).toBeTruthy();
    openVersions();
    expect(screen.queryByRole("button", { name: /Delete version/ })).toBeNull();
    expect(
      useQueryMock.mock.calls.some(
        ([query]) => getFunctionName(query as never) === "packages:canDeleteVersions",
      ),
    ).toBe(true);
  });

  it("checks plugin management when a dev viewer exists without a Convex auth session", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: { _id: "users:1", role: "user" },
    });
    useQueryMock.mockReturnValue({
      package: { _id: "packages:1", name: "demo-plugin", displayName: "Demo Plugin" },
      latestRelease: { _id: "packageReleases:1" },
    });
    loaderDataMock = {
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "1.0.0",
        },
        owner: { handle: "demo-owner", displayName: "Demo Owner", image: null },
      },
      version: null,
      versions: emptyVersions,
      readme: null,
      rateLimited: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      name: "demo-plugin",
      candidateNames: ["@openclaw/demo-plugin", "demo-plugin"],
    });
    expect(screen.getByRole("link", { name: "New version" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
  });

  it.each([
    ["clean", "Clean"],
    ["suspicious", "Review"],
  ] as const)(
    "renders the %s audit verdict with ordered plugin metadata",
    async (status, verdict) => {
      loaderDataMock = {
        detail: {
          ...loaderDataMock.detail,
          package: {
            ...loaderDataMock.detail.package!,
            latestVersion: "1.0.0",
            categories: ["web"],
            topics: ["search"],
            stats: { downloads: 597, installs: 0, stars: 0, versions: 1 },
          },
        },
        version: {
          package: {
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
          },
          version: {
            version: "1.0.0",
            createdAt: 1,
            changelog: "Initial release",
            distTags: ["latest"],
            files: [],
            compatibility: null,
            verification: {
              tier: "source-linked",
              scope: "artifact-only",
              scanStatus: status,
              sourceRepo: "demo-owner/demo-plugin",
            },
            sha256hash: "a".repeat(64),
            llmAnalysis: {
              status,
              verdict: status,
              summary: "Looks safe.",
              checkedAt: 1,
            },
          },
        },
        versions: emptyVersions,
        readme: null,
        rateLimited: null,
      };

      const route = await loadRoute();
      const Component = route.__config.component as ComponentType;

      render(<Component />);

      const metadata = screen.getByLabelText("Plugin metadata");
      expect(
        within(metadata)
          .getAllByRole("term")
          .map((term) => term.textContent?.trim()),
      ).toEqual([
        "Security audit",
        "Version",
        "Updated",
        "Published",
        "Downloads",
        "Categories",
        "Repository",
        "Topics",
      ]);
      const audit = within(metadata).getByRole("link", {
        name: new RegExp(`View Security Audit.*${verdict}`, "i"),
      });
      expect(audit.textContent?.trim()).toBe(verdict);
      expect(within(metadata).queryByText(/^Audit$/i)).toBeNull();
      expect(audit.getAttribute("href")).toBe("/plugins/demo-plugin/security-audit");
      expect(
        within(metadata).getByRole("button", {
          name: "Security checks for vulnerabilities and agentic risk",
        }),
      ).toBeTruthy();
      expect(within(metadata).getByText("1.0.0", { exact: true })).toBeTruthy();
      expect(within(metadata).getByText("597")).toBeTruthy();
      expect(
        within(metadata)
          .getByRole("link", { name: /demo-plugin/i })
          .getAttribute("href"),
      ).toBe("https://github.com/demo-owner/demo-plugin");
      expect(screen.queryByText("Looks safe.")).toBeNull();
    },
  );

  it("does not render owner-only plugin scanner rerun state in the detail security summary", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1" },
    });
    useQueryMock.mockReturnValue(null);
    loaderDataMock = {
      detail: loaderDataMock.detail,
      version: {
        package: {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
        },
        version: {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Initial release",
          distTags: ["latest"],
          files: [],
          compatibility: null,
          verification: null,
          sha256hash: "a".repeat(64),
          llmAnalysis: null,
        },
      },
      versions: emptyVersions,
      readme: null,
      rateLimited: null,
    };

    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: "Rescan" })).toBeNull();
    expect(screen.queryByText(/rescans/i)).toBeNull();
  });

  it("renders ClawPack artifact details and uses the artifact download route", async () => {
    loaderDataMock = {
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "1.0.0",
          artifact: {
            kind: "npm-pack",
            sha256: "a".repeat(64),
            size: 2048,
            format: "tgz",
            npmIntegrity: "sha512-demo",
            npmShasum: "b".repeat(40),
            npmTarballName: "demo-plugin-1.0.0.tgz",
            npmFileCount: 3,
          },
        },
        owner: null,
      },
      version: {
        package: {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
        },
        version: {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Initial release",
          distTags: ["latest"],
          files: [],
          compatibility: null,
          verification: null,
          artifact: {
            kind: "npm-pack",
            sha256: "a".repeat(64),
            size: 2048,
            format: "tgz",
            npmIntegrity: "sha512-demo",
            npmShasum: "b".repeat(40),
            npmTarballName: "demo-plugin-1.0.0.tgz",
            npmFileCount: 3,
          },
          sha256hash: null,
          llmAnalysis: null,
        },
      },
      versions: emptyVersions,
      readme: null,
      rateLimited: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const dialog = openVersions();
    expect(within(dialog).getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
      "/api/v1/packages/demo-plugin/versions/1.0.0/artifact/download",
    );
    fireEvent.click(within(dialog).getByRole("tab", { name: "Compatibility" }));
    expect(within(dialog).getByText("ClawPack")).toBeTruthy();
    expect(within(dialog).getByText("demo-plugin-1.0.0.tgz")).toBeTruthy();
    expect(within(dialog).getByText("sha512-demo")).toBeTruthy();
    closeDialog();
    const card = getInstallCard();
    expect(card.querySelector("pre")?.textContent).toBe(
      "openclaw plugins install clawhub:demo-plugin@latest",
    );
  });

  it("labels legacy ZIP plugin artifacts as compatibility risk", async () => {
    loaderDataMock = {
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "1.0.0",
          artifact: {
            kind: "legacy-zip",
            sha256: "a".repeat(64),
            format: "zip",
          },
        },
        owner: null,
      },
      version: {
        package: {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
        },
        version: {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Initial release",
          distTags: ["latest"],
          files: [],
          compatibility: null,
          verification: null,
          artifact: {
            kind: "legacy-zip",
            sha256: "a".repeat(64),
            format: "zip",
          },
          sha256hash: null,
          llmAnalysis: null,
        },
      },
      versions: emptyVersions,
      readme: null,
      rateLimited: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const dialog = openVersions();
    expect(within(dialog).getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
      "/api/v1/packages/demo-plugin/download?version=1.0.0",
    );
    fireEvent.click(within(dialog).getByRole("tab", { name: "Compatibility" }));
    expect(within(dialog).getByText("Legacy ZIP")).toBeTruthy();
    expect(within(dialog).getByText(/legacy ZIP path/i)).toBeTruthy();
  });

  it("hides retirement notices, incompatibility alerts, and validation outputs from visitors", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    });
    useQueryMock.mockImplementation((query: unknown) => {
      const name = getFunctionName(query as never);
      if (name === "packages:getPackageInspectorValidationSummaryPublic") {
        return {
          findingCount: 1,
          errorCount: 1,
          warningCount: 0,
          incompatibleAfterOpenClawVersion: "0.9.0",
          apiRetirements: [
            {
              deprecatedApi: "readAcpSessionEntry",
              replacement: "readAcpSessionEntryAsync",
              removeAfter: "2026-12-31",
            },
          ],
        };
      }
      return null;
    });
    loaderDataMock = {
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "1.0.0",
        },
        owner: null,
      },
      version: {
        package: {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
        },
        version: {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Initial release",
          distTags: ["latest"],
          files: [],
          compatibility: null,
          verification: null,
          artifact: null,
          sha256hash: null,
          llmAnalysis: null,
        },
      },
      versions: emptyVersions,
      readme: null,
      rateLimited: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(
      screen.queryByText("This plugin is incompatible with OpenClaw versions greater than 0.9.0."),
    ).toBeNull();
    expect(screen.queryByRole("region", { name: "OpenClaw API updates" })).toBeNull();
    expect(screen.queryByText("API details")).toBeNull();
    expect(getInstallCard()).toBeTruthy();
    openVersions();
    expect(screen.queryByRole("tab", { name: /Validation/ })).toBeNull();
    expect(screen.queryByText("missing-expected-seam")).toBeNull();
  });

  it("shows validation outputs inline to plugin managers", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:owner" },
    });
    useQueryMock.mockImplementation((query: unknown) => {
      const name = getFunctionName(query as never);
      if (name === "packages:getManageContext") {
        return {
          package: { name: "demo-plugin", displayName: "Demo Plugin" },
          latestRelease: { version: "1.0.0" },
        };
      }
      if (name === "packages:getPackageInspectorValidationSummaryPublic") {
        return {
          findingCount: 2,
          errorCount: 1,
          warningCount: 1,
          incompatibleAfterOpenClawVersion: "0.9.0",
        };
      }
      if (name === "packages:listPackageInspectorWarningsForManager") {
        return [
          {
            packageName: "demo-plugin",
            version: "1.0.0",
            findingKind: "warning",
            code: "legacy-before-agent-start",
            issueClass: "deprecation-warning",
            severity: "P2",
            message: "legacy before_agent_start hook is deprecated",
            evidence: ["src/index.ts:4"],
            inspectorVersion: "0.4.0",
            targetOpenClawVersion: "0.9.0",
            scanSource: "nightly",
            authorRemediation: {
              summary: "Replace the legacy before_agent_start hook with current prompt hooks.",
              docsUrl:
                "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-before-agent-start",
            },
            createdAt: 1,
          },
          {
            packageName: "demo-plugin",
            version: "1.0.0",
            findingKind: "error",
            code: "missing-expected-seam",
            issueClass: "compatibility-error",
            severity: "P0",
            message: "registerTool is no longer available",
            evidence: ["dist/index.js:2"],
            inspectorVersion: "0.4.0",
            targetOpenClawVersion: "0.9.0",
            scanSource: "nightly",
            createdAt: 2,
          },
        ];
      }
      return null;
    });
    loaderDataMock = {
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "1.0.0",
        },
        owner: null,
      },
      version: {
        package: {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
        },
        version: {
          version: "1.0.0",
          createdAt: 1,
          changelog: "Initial release",
          distTags: ["latest"],
          files: [],
          compatibility: null,
          verification: null,
          artifact: null,
          sha256hash: null,
          llmAnalysis: null,
        },
      },
      versions: emptyVersions,
      readme: null,
      rateLimited: null,
    };
    window.location.hash = "#validation";
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("region", { name: "Validation" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Validation", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Validation/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "2 warnings" })).toBeNull();
    expect(screen.getByText("Validate locally before publishing")).toBeTruthy();
    expect(document.getElementById("validation-toolbar-cli")?.getAttribute("aria-labelledby")).toBe(
      "validation-toolbar-label",
    );
    const titleActions = document.querySelector(".plugin-validation-panel-title-actions");
    expect(titleActions?.querySelector(".plugin-validation-panel-stats")).toBeTruthy();
    expect(titleActions?.textContent).toMatch(/0 errors/);
    expect(titleActions?.textContent).toMatch(/1 warning/);
    expect(titleActions?.querySelector(".plugin-validation-panel-agent")).toBeNull();
    const validationToolbar = screen.getByRole("toolbar", { name: "Validation actions" });
    expect(
      within(validationToolbar).getByText(
        "clawhub package validate <path-to-plugin> --openclaw-version 0.9.0",
      ),
    ).toBeTruthy();
    const commandBlock = validationToolbar.querySelector(".plugin-validation-command-block");
    expect(commandBlock?.querySelector(".plugin-validation-toolbar-label")).toBeTruthy();
    expect(validationToolbar.querySelector(":scope > .plugin-validation-toolbar-label")).toBeNull();
    expect(validationToolbar.querySelector(".plugin-validation-toolbar-agent")).toBeTruthy();
    expect(
      within(validationToolbar as HTMLElement).getByRole("button", {
        name: "Copy fix instructions",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy validate command" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy fix instructions" })).toBeTruthy();
    expect(screen.getByText("Copy instructions")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agent" })).toBeNull();
    expect(screen.getByText("legacy-before-agent-start")).toBeTruthy();
    expect(screen.getByText(/Deprecated API/)).toBeTruthy();
    expect(screen.queryByText(/Warning · Deprecated API · P2/)).toBeNull();
    expect(screen.queryByText("deprecation-warning")).toBeNull();
    expect(screen.queryByText("missing-expected-seam")).toBeNull();
    expect(screen.queryByText("registerTool is no longer available")).toBeNull();
    expect(screen.queryByText("Inspector")).toBeNull();
    expect(screen.queryByText("Scan")).toBeNull();
    expect(screen.getByRole("link", { name: "View fix guide ↗" }).getAttribute("href")).toBe(
      "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-before-agent-start",
    );
    const validationRegion = screen.getByRole("region", { name: "Validation" });
    expect(within(validationRegion).getByText("Release")).toBeTruthy();
    expect(within(validationRegion).getByText("v1.0.0")).toBeTruthy();
    expect(within(validationRegion).getByText("Target")).toBeTruthy();
    expect(within(validationRegion).getByText("OpenClaw 0.9.0")).toBeTruthy();
    expect(
      within(validationRegion).getAllByText(
        "clawhub package validate <path-to-plugin> --openclaw-version 0.9.0",
      ),
    ).toHaveLength(2);
    expect(screen.getByText(/Legacy before_agent_start hook is deprecated\./)).toBeTruthy();
    expect(screen.getByText(/We found/)).toBeTruthy();
    expect(screen.queryByText(/Hey,/)).toBeNull();
    expect(screen.getByText("1 issue")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Validation" })).getByText("demo-plugin"),
    ).toBeTruthy();
    expect(screen.getByText(/version 1\.0\.0/)).toBeTruthy();
    expect(
      screen.getByText(/Review the findings below, apply the fix, and upload a new version\./),
    ).toBeTruthy();
  });

  it("does not show validation outputs to signed-out viewers when the hash changes", async () => {
    useQueryMock.mockImplementation((query: unknown) => {
      const name = getFunctionName(query as never);
      if (name === "packages:getPackageInspectorValidationSummaryPublic") {
        return {
          findingCount: 1,
          errorCount: 0,
          warningCount: 1,
          incompatibleAfterOpenClawVersion: null,
        };
      }
      return null;
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    expect(screen.queryByText("legacy-before-agent-start")).toBeNull();

    await act(async () => {
      window.location.hash = "#validation";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(screen.queryByText("legacy-before-agent-start")).toBeNull();
  });

  it("shows a retryable empty state when the detail lookup is rate limited", async () => {
    loaderDataMock = {
      detail: { package: null, owner: null },
      version: null,
      versions: emptyVersions,
      readme: null,
      rateLimited: {
        scope: "detail",
        retryAfterSeconds: 15,
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByText("Plugin details are temporarily unavailable")).toBeTruthy();
    expect(screen.getByText(/Try again in about 15 seconds/i)).toBeTruthy();
  });

  it.each([false, true])(
    "renders a beta-only plugin's README (filtered first page: %s)",
    async (filteredFirstPage) => {
      const release = "0.1.0-beta.1";
      const readme = "# Beta plugin setup instructions";
      const route = await loadRoute();
      vi.mocked(fetchPackageDetail).mockResolvedValueOnce(loaderDataMock.detail);
      if (filteredFirstPage) {
        vi.mocked(fetchPackageVersions).mockResolvedValueOnce({ items: [], nextCursor: "next" });
      }
      vi.mocked(fetchPackageVersions).mockResolvedValueOnce({
        items: [{ version: release, createdAt: 1, changelog: "Initial beta", distTags: ["beta"] }],
        nextCursor: null,
      });
      vi.mocked(fetchPackageVersion).mockResolvedValueOnce({
        package: null,
        version: { version: release, createdAt: 1, changelog: "Initial beta", files: [] },
      });
      vi.mocked(fetchPackageReadme).mockImplementation(async (_name, version) =>
        version === release ? readme : null,
      );

      loaderDataMock = await route.__config.loader!({ params: { name: "demo-plugin" } });
      const Component = route.__config.component as ComponentType;
      render(<Component />);

      expect(screen.getByText(readme)).toBeTruthy();
      expect(screen.queryByText("No README available")).toBeNull();
      expect(loaderDataMock.detail.package?.latestVersion).toBeNull();
      expect(loaderDataMock.version?.version?.version).toBe(release);
    },
  );

  it("keeps an empty plugin page when no published release exists", async () => {
    const route = await loadRoute();
    vi.mocked(fetchPackageDetail).mockResolvedValueOnce(loaderDataMock.detail);
    vi.mocked(fetchPackageReadme).mockResolvedValueOnce(null);

    const result = await route.__config.loader!({ params: { name: "demo-plugin" } });

    expect(result.version).toBeNull();
    expect(result.readme).toBeNull();
    expect(fetchPackageVersion).not.toHaveBeenCalled();
    expect(fetchPackageReadme).not.toHaveBeenCalled();
  });

  it("keeps plugin details when fallback release discovery is rate limited", async () => {
    const route = await loadRoute();
    vi.mocked(fetchPackageDetail).mockResolvedValueOnce(loaderDataMock.detail);
    vi.mocked(fetchPackageReadme).mockResolvedValueOnce(null);
    vi.mocked(fetchPackageVersions).mockRejectedValueOnce({ status: 429, retryAfterSeconds: 11 });

    const result = await route.__config.loader!({ params: { name: "demo-plugin" } });

    expect(result.detail.package?.name).toBe("demo-plugin");
    expect(result.readme).toBeNull();
    expect(result.rateLimited).toEqual({ scope: "metadata", retryAfterSeconds: 11 });
  });

  it("downgrades rate-limited README/version fetches into partial detail data", async () => {
    const route = await loadRoute();
    const loader = route.__config.loader as ({
      params,
    }: {
      params: { name: string };
    }) => Promise<PluginDetailLoaderData>;
    const fetchPackageDetailMock = vi.mocked(fetchPackageDetail);
    const fetchPackageReadmeMock = vi.mocked(fetchPackageReadme);
    const fetchPackageVersionMock = vi.mocked(fetchPackageVersion);

    fetchPackageDetailMock.mockResolvedValueOnce({
      package: {
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        summary: "Demo summary",
        latestVersion: "1.0.0",
        createdAt: 1,
        updatedAt: 1,
        tags: {},
        compatibility: null,
        verification: null,
      },
      owner: null,
    });
    fetchPackageReadmeMock.mockRejectedValueOnce({ status: 429, retryAfterSeconds: 11 });
    fetchPackageVersionMock.mockRejectedValueOnce({ status: 429, retryAfterSeconds: 11 });

    const result = await loader({ params: { name: "demo-plugin" } });

    expect(result.detail.package?.name).toBe("demo-plugin");
    expect(result.readme).toBeNull();
    expect(result.version).toBeNull();
    expect(result.versions).toBeUndefined();
    expect(fetchPackageVersions).not.toHaveBeenCalled();
    expect(result.rateLimited).toEqual({
      scope: "metadata",
      retryAfterSeconds: 11,
    });
  });

  it("keeps plugin detail available when active release history is unavailable", async () => {
    const route = await loadRoute();
    const loader = route.__config.loader as ({
      params,
    }: {
      params: { name: string };
    }) => Promise<PluginDetailLoaderData>;

    vi.mocked(fetchPackageDetail).mockResolvedValueOnce({
      package: {
        ...loaderDataMock.detail.package!,
        latestVersion: "1.0.0",
      },
      owner: null,
    });
    vi.mocked(fetchPackageVersion).mockResolvedValueOnce({ package: null, version: null });
    vi.mocked(fetchPackageReadme).mockResolvedValueOnce("README");
    const result = await loader({ params: { name: "demo-plugin" } });

    expect(result.readme).toBe("README");
    expect(result.version).toEqual({ package: null, version: null });
    expect(result.versions).toBeUndefined();
    expect(fetchPackageVersions).not.toHaveBeenCalled();
    expect(result.rateLimited).toBeNull();
  });

  it("keeps latest version and README when active release history is rate limited", async () => {
    const route = await loadRoute();
    const loader = route.__config.loader as ({
      params,
    }: {
      params: { name: string };
    }) => Promise<PluginDetailLoaderData>;
    const latestVersion = { package: null, version: null };

    vi.mocked(fetchPackageDetail).mockResolvedValueOnce({
      package: {
        ...loaderDataMock.detail.package!,
        latestVersion: "1.0.0",
      },
      owner: null,
    });
    vi.mocked(fetchPackageVersion).mockResolvedValueOnce(latestVersion);
    vi.mocked(fetchPackageReadme).mockResolvedValueOnce("README");
    const result = await loader({ params: { name: "demo-plugin" } });

    expect(result.version).toBe(latestVersion);
    expect(result.readme).toBe("README");
    expect(result.versions).toBeUndefined();
    expect(fetchPackageVersions).not.toHaveBeenCalled();
    expect(result.rateLimited).toBeNull();
  });

  it("prefers the official scoped package name for short plugin routes", async () => {
    const route = await loadRoute();
    const loader = route.__config.loader as ({
      params,
    }: {
      params: { name: string };
    }) => Promise<PluginDetailLoaderData>;
    const fetchPackageDetailMock = vi.mocked(fetchPackageDetail);
    const fetchPackageReadmeMock = vi.mocked(fetchPackageReadme);
    const fetchPackageVersionMock = vi.mocked(fetchPackageVersion);

    fetchPackageDetailMock.mockResolvedValueOnce({
      package: {
        name: "@openclaw/matrix",
        displayName: "Matrix",
        family: "code-plugin",
        channel: "official",
        isOfficial: true,
        summary: "Matrix plugin",
        latestVersion: "2026.3.22",
        createdAt: 1,
        updatedAt: 1,
        tags: { latest: "2026.3.22" },
        compatibility: null,
        verification: null,
      },
      owner: { handle: "openclaw", displayName: "OpenClaw", image: null },
    });
    fetchPackageReadmeMock.mockResolvedValueOnce("README");
    fetchPackageVersionMock.mockResolvedValueOnce({ package: null, version: null });

    await expect(loader({ params: { name: "matrix" } })).rejects.toEqual({
      redirect: { href: "/openclaw/plugins/matrix", replace: true },
    });

    expect(fetchPackageDetailMock).toHaveBeenCalledTimes(1);
    expect(fetchPackageDetailMock).toHaveBeenCalledWith("@openclaw/matrix");
    expect(fetchPackageReadmeMock).toHaveBeenCalledWith("@openclaw/matrix", "2026.3.22");
    expect(fetchPackageVersionMock).toHaveBeenCalledWith("@openclaw/matrix", "2026.3.22");
    expect(fetchPackageVersions).not.toHaveBeenCalled();
  });

  it("uses extension npm config for short plugin route candidates", async () => {
    const route = await loadRoute();
    const loader = route.__config.loader as ({
      params,
    }: {
      params: { name: string };
    }) => Promise<PluginDetailLoaderData>;
    const fetchPackageDetailMock = vi.mocked(fetchPackageDetail);
    const fetchPackageReadmeMock = vi.mocked(fetchPackageReadme);
    const fetchPackageVersionMock = vi.mocked(fetchPackageVersion);

    fetchPackageDetailMock.mockResolvedValueOnce({
      package: {
        name: "@openclaw/anthropic-provider",
        displayName: "Anthropic",
        family: "code-plugin",
        channel: "official",
        isOfficial: true,
        summary: "Anthropic provider",
        latestVersion: "2026.3.22",
        createdAt: 1,
        updatedAt: 1,
        tags: { latest: "2026.3.22" },
        compatibility: null,
        verification: null,
      },
      owner: { handle: "openclaw", displayName: "OpenClaw", image: null },
    });
    fetchPackageReadmeMock.mockResolvedValueOnce("README");
    fetchPackageVersionMock.mockResolvedValueOnce({ package: null, version: null });

    await expect(loader({ params: { name: "anthropic" } })).rejects.toEqual({
      redirect: { href: "/openclaw/plugins/anthropic-provider", replace: true },
    });

    expect(fetchPackageDetailMock).toHaveBeenCalledTimes(1);
    expect(fetchPackageDetailMock).toHaveBeenCalledWith("@openclaw/anthropic-provider");
    expect(fetchPackageReadmeMock).toHaveBeenCalledWith(
      "@openclaw/anthropic-provider",
      "2026.3.22",
    );
    expect(fetchPackageVersionMock).toHaveBeenCalledWith(
      "@openclaw/anthropic-provider",
      "2026.3.22",
    );
  });
});
