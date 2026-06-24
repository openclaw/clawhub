/* @vitest-environment jsdom */

import { createRequire } from "node:module";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const isRateLimitedPackageApiErrorMock = vi.fn(
  (error: unknown) =>
    typeof error === "object" && error !== null && (error as { status?: number }).status === 429,
);
const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const convexQueryMock = vi.fn();
const convexClientMock = { query: convexQueryMock };
const useAuthStatusMock = vi.fn();
const routerInvalidateMock = vi.fn();
let pathnameMock = "/plugins/demo-plugin";

type PluginDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  versions: Awaited<ReturnType<typeof fetchPackageVersions>> | null;
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
  useMutation: (...args: unknown[]) => useMutationMock(...args),
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

vi.mock("../components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

async function loadRoute() {
  return (await import("../routes/plugins/$name")).Route as unknown as {
    __config: {
      loader?: ({ params }: { params: { name: string } }) => Promise<PluginDetailLoaderData>;
      component?: ComponentType;
    };
  };
}

function openRelease(version: string) {
  const versionPattern = new RegExp(`v${version.replaceAll(".", "\\.")}`);
  const toggle = screen
    .getAllByRole("button")
    .find(
      (button) =>
        button.classList.contains("skill-version-release-toggle") &&
        versionPattern.test(button.textContent ?? ""),
    );
  if (!toggle) {
    throw new Error(`Version toggle for v${version} not found`);
  }
  fireEvent.click(toggle);
}

describe("plugin detail route", () => {
  function setViewportWidth(width: number) {
    vi.stubGlobal("matchMedia", (query: string) => {
      const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query)?.[1];
      const maxWidth = /\(max-width:\s*(\d+)px\)/.exec(query)?.[1];
      const matches = minWidth
        ? width >= Number(minWidth)
        : maxWidth
          ? width <= Number(maxWidth)
          : false;

      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    });
  }

  beforeEach(() => {
    setViewportWidth(1071);
    paramsMock = { name: "demo-plugin" };
    pathnameMock = "/plugins/demo-plugin";
    window.location.hash = "";
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
    vi.unstubAllGlobals();
  });

  it("uses mobile About and Stats tabs below 901px", async () => {
    setViewportWidth(488);
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: {
          ...loaderDataMock.detail.package!,
          latestVersion: "1.0.0",
          stats: { downloads: 597, installs: 0, stars: 0, versions: 1 },
        },
        owner: { handle: "demo-owner", displayName: "Demo Owner", image: null },
      },
      version: loaderDataMock.version,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    const { container } = render(<Component />);

    await waitFor(() => {
      expect(container.querySelector(".detail-mobile-master-tab-list")).toBeTruthy();
    });

    expect(screen.getByRole("tab", { name: "About" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Stats" }).getAttribute("aria-selected")).toBe("false");
    expect(
      container.querySelector("#plugin-mobile-master-panel-stats")?.hasAttribute("hidden"),
    ).toBe(true);
    expect(container.querySelector(".detail-sidebar-stats")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Stats" }));

    expect(screen.getByRole("tab", { name: "Stats" }).getAttribute("aria-selected")).toBe("true");
    expect(
      container.querySelector("#plugin-mobile-master-panel-stats")?.hasAttribute("hidden"),
    ).toBe(false);
    expect(screen.getByText("Downloads")).toBeTruthy();
  });

  it("hides download actions when the plugin has no latest release", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByText(/Latest release:/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Download zip" })).toBeNull();
  });

  it("renders canonical topics in the detail hero", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        ...loaderDataMock.detail,
        package: {
          ...loaderDataMock.detail.package!,
          topics: ["Web Search", "Research"],
        },
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByLabelText("Topics").textContent).toContain("#web-search");
    expect(screen.getByLabelText("Topics").textContent).toContain("#research");
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
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

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
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    expect(fetchPackageVersions).toHaveBeenCalledWith("demo-plugin", {
      cursor: "versions:next",
      limit: 20,
    });
    openRelease("2.0.0");
    expect(screen.getByText("Current page")).toBeTruthy();
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button", { hidden: true })
          .some(
            (button) =>
              button.getAttribute("aria-controls") === "version-changelog-1.0.0" &&
              button.classList.contains("skill-version-release-toggle"),
          ),
      ).toBe(true);
    });
    openRelease("1.0.0");
    expect(screen.getByText("Loaded next page")).toBeTruthy();
    expect(
      document.querySelector('a[href="/api/v1/packages/demo-plugin/download?version=1.0.0"]'),
    ).toBeNull();
    expect(screen.queryByText("Download .zip")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "README.md" }));
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

    expect(
      screen
        .getAllByRole("button", { hidden: true })
        .some(
          (button) =>
            button.getAttribute("aria-controls") === "version-changelog-1.0.0" &&
            button.classList.contains("skill-version-release-toggle"),
        ),
    ).toBe(true);
    expect(fetchPackageVersions).toHaveBeenCalledTimes(1);
  });

  it("resets shared detail state when navigating between scoped plugins without a hash", async () => {
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
      <PluginDetailPage name="@scope/plugin-a" loaderData={loaderDataMock} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

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
    rerender(<PluginDetailPage name="@scope/plugin-b" loaderData={loaderDataMock} />);

    expect(screen.getByRole("tab", { name: "README.md" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("Plugin B README")).toBeTruthy();
    expect(screen.queryByText("Plugin A loaded release")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

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
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

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
            mcpServers: [{ name: "exampleMcp" }],
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
    vi.mocked(fetchPackageFile).mockResolvedValueOnce("# Research\n\nDeep research assistant.");
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(
      Array.from(document.querySelectorAll(".detail-mobile-tabs .tab-button"), (tab) =>
        tab.textContent?.trim(),
      ),
    ).toEqual(["README.md", "Skills", "MCP Servers", "Configuration", "Compatibility", "Versions"]);
    expect(screen.getByRole("tab", { name: "Compatibility" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Configuration" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "MCP Servers" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Skills" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Compatibility" }));
    expect(screen.getByText("OpenClaw plugin API")).toBeTruthy();
    expect(screen.getByText("^2.0.0")).toBeTruthy();
    expect(screen.queryByText("EXAMPLE_PLUGIN_API_KEY")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Configuration" }));
    expect(screen.getByText("EXAMPLE_PLUGIN_API_KEY")).toBeTruthy();
    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.getByText("Sensitive")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "MCP Servers" }));
    expect(screen.getAllByText("exampleMcp").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByText("Deep research assistant.")).toBeTruthy();
    expect(fetchPackageFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /preview research/i }));

    await waitFor(() => {
      expect(fetchPackageFile).toHaveBeenCalledWith(
        "example-ai-plugin",
        "skills/research/SKILL.md",
        "1.2.3",
      );
    });
    await waitFor(() => {
      expect(
        screen.getAllByText((_content, element) =>
          Boolean(element?.textContent?.includes("# Research")),
        ).length,
      ).toBeGreaterThan(0);
    });
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
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

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
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));
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

  it("selects the versions tab from the versions hash", async () => {
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
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    await act(async () => {});

    expect(screen.getByRole("tab", { name: "Versions" }).getAttribute("aria-selected")).toBe(
      "true",
    );
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
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

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
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

    expect(screen.getByText("Release history is temporarily unavailable.")).toBeTruthy();
    expect(screen.queryByText("No active releases are available.")).toBeNull();
  });

  it("links plugin breadcrumb owners to canonical publisher profiles", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        package: loaderDataMock.detail.package,
        owner: { handle: "openclaw", displayName: "OpenClaw", image: null },
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    const { container } = render(<Component />);

    expect(
      container.querySelector('nav[aria-label="Plugin breadcrumbs"] a[href="/openclaw"]'),
    ).toBeTruthy();
  });

  it("omits scoped package prefixes from plugin breadcrumbs", async () => {
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

    const { container } = render(<Component />);

    const packageCrumb = container.querySelector(
      'nav[aria-label="Plugin breadcrumbs"] a[href="/openclaw/plugins/firecrawl-plugin"]',
    );
    expect(packageCrumb?.textContent).toBe("firecrawl-plugin");
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

    render(<Component />);

    expect(screen.getAllByText("Official").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Official").length).toBeGreaterThan(0);
    expect(screen.queryByText("Verified")).toBeNull();
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
    const { container } = render(<Component />);

    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.queryByText("30-day Installs")).toBeNull();
    expect(container.querySelectorAll(".metric-trend-card-skeleton")).toHaveLength(1);
    expect(screen.queryByRole("img", { name: "Daily installs over the last 30 days" })).toBeNull();
  });

  it("renders canonical topics in the detail hero", async () => {
    loaderDataMock = {
      ...loaderDataMock,
      detail: {
        ...loaderDataMock.detail,
        package: {
          ...loaderDataMock.detail.package!,
          topics: ["Web Search", "Research"],
        },
      },
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByLabelText("Topics").textContent).toContain("#web-search");
    expect(screen.getByLabelText("Topics").textContent).toContain("#research");
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

    const downloadsLabel = screen.getByText("Downloads");
    const currentVersionLabel = screen.getByText("Current version");
    expect(downloadsLabel.compareDocumentPosition(currentVersionLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Daily downloads over the last 30 days" })).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Daily downloads over the last 30 days" }),
      ).toBeTruthy(),
    );
    expect(screen.getByText("14")).toBeTruthy();
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

    const sidebarMetadata = document.querySelector('dl[aria-label="Plugin metadata"]');
    expect(sidebarMetadata).toBeTruthy();
    const sidebarRows = Array.from(
      sidebarMetadata?.querySelectorAll(".sidebar-metadata-row") ?? [],
      (row) => ({
        text: row.textContent?.replace(/\s+/g, " ").trim() ?? "",
        hasDownload: Boolean(row.querySelector(".plugin-sidebar-download-button")),
      }),
    );
    const downloadsRow = sidebarRows.find((row) => row.text.includes("Downloads"));
    const creatorRow = sidebarRows.find((row) => row.text.includes("Creator"));
    const downloadOnlyRow = sidebarRows.find((row) => row.hasDownload);
    const typeRow = sidebarRows.find((row) => row.text.includes("Code Plugin"));
    expect(downloadsRow?.hasDownload).toBe(false);
    expect(downloadOnlyRow).toBeTruthy();
    expect(creatorRow).toBeTruthy();
    expect(typeRow).toBeTruthy();
    expect(sidebarRows.at(-1)).toEqual(downloadOnlyRow);
    expect(screen.getByRole("link", { name: /Download/i }).getAttribute("href")).toBe(
      "/api/v1/packages/demo-plugin/download?version=1.0.0",
    );
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
    const { container } = render(<Component />);

    expect(container.querySelectorAll(".metric-trend-card-skeleton")).toHaveLength(1);
    await waitFor(() =>
      expect(container.querySelectorAll(".metric-trend-card-skeleton")).toHaveLength(0),
    );

    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.getByText("1.2k")).toBeTruthy();
    expect(screen.queryByText("Installs")).toBeNull();
    expect(container.querySelectorAll(".metric-trend-card-skeleton")).toHaveLength(0);
    expect(screen.queryByRole("img", { name: "Daily installs over the last 30 days" })).toBeNull();
    expect(screen.queryByRole("img", { name: "Daily downloads over the last 30 days" })).toBeNull();

    const sidebarMetadata = document.querySelector('dl[aria-label="Plugin metadata"]');
    const downloadsRow = sidebarMetadata?.querySelector(".sidebar-metadata-row-large");
    expect(downloadsRow?.textContent).toContain("Downloads");
    expect(downloadsRow?.querySelector(".plugin-sidebar-download-button")).toBeTruthy();
    expect(sidebarMetadata?.querySelectorAll(".plugin-sidebar-download-button")).toHaveLength(1);
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
          vtAnalysis: null,
          llmAnalysis: null,
          staticScan: null,
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
    expect(screen.getByRole("link", { name: /download/i })).toBeTruthy();
    expect(newVersionLink.getAttribute("href")).toBe(
      "/plugins/publish?ownerHandle=demo-owner&name=demo-plugin&displayName=Demo+Plugin",
    );
    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      name: "demo-plugin",
      candidateNames: ["@openclaw/demo-plugin", "demo-plugin"],
    });
  });

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
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "Versions" }));

    expect(screen.getByRole("link", { name: "New version" })).toBeTruthy();
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

  it("renders package security scan results when scan data is present", async () => {
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
          verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
          sha256hash: "a".repeat(64),
          vtAnalysis: {
            status: "clean",
            checkedAt: 1,
          },
          llmAnalysis: {
            status: "clean",
            verdict: "clean",
            summary: "Looks safe.",
            checkedAt: 1,
          },
          staticScan: {
            status: "clean",
            reasonCodes: [],
            findings: [],
            summary: "No issues",
            engineVersion: "1",
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

    expect(screen.getByText("Security audit")).toBeTruthy();
    expect(screen.getByText("Pass")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View Security Audit" }).getAttribute("href")).toBe(
      "/plugins/demo-plugin/security-audit",
    );
    expect(
      screen.getByRole("button", {
        name: "Security checks across malware telemetry and agentic risk",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Looks safe.")).toBeNull();

    const sidebarMetadata = document.querySelector('dl[aria-label="Plugin metadata"]');
    expect(sidebarMetadata).toBeTruthy();
    const sidebarLabels = Array.from(
      sidebarMetadata?.querySelectorAll(".sidebar-metadata-label") ?? [],
      (label) => label.textContent?.trim(),
    );
    const securityAuditLabelIndex = sidebarLabels.findIndex((label) =>
      label?.startsWith("Security audit"),
    );
    const downloadsLabelIndex = sidebarLabels.findIndex((label) => label?.includes("Downloads"));
    expect(securityAuditLabelIndex).toBeGreaterThanOrEqual(0);
    expect(downloadsLabelIndex).toBeGreaterThanOrEqual(0);
    expect(securityAuditLabelIndex).toBeGreaterThan(downloadsLabelIndex);
    expect(screen.queryByRole("tab", { name: "Capabilities" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Verification" })).toBeNull();
  });

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
          vtAnalysis: null,
          llmAnalysis: null,
          staticScan: null,
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
          vtAnalysis: null,
          llmAnalysis: null,
          staticScan: null,
        },
      },
      versions: emptyVersions,
      readme: null,
      rateLimited: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("tab", { name: "Compatibility" }));
    expect(screen.getByText("ClawPack")).toBeTruthy();
    expect(screen.getByText("demo-plugin-1.0.0.tgz")).toBeTruthy();
    expect(screen.getByText("sha512-demo")).toBeTruthy();
    expect(screen.getByText("openclaw plugins install clawhub:demo-plugin")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Download/i }).getAttribute("href")).toBe(
      "/api/v1/packages/demo-plugin/versions/1.0.0/artifact/download",
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
          vtAnalysis: null,
          llmAnalysis: null,
          staticScan: null,
        },
      },
      versions: emptyVersions,
      readme: null,
      rateLimited: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("tab", { name: "Compatibility" }));
    expect(screen.getByText("Legacy ZIP")).toBeTruthy();
    expect(screen.getByText(/legacy ZIP path/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Download/i }).getAttribute("href")).toBe(
      "/api/v1/packages/demo-plugin/download?version=1.0.0",
    );
  });

  it("shows a public incompatibility alert without exposing validation outputs", async () => {
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
          vtAnalysis: null,
          llmAnalysis: null,
          staticScan: null,
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
      screen.getByText("This plugin is incompatible with OpenClaw versions greater than 0.9.0."),
    ).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Validation/ })).toBeNull();
    expect(screen.queryByText("missing-expected-seam")).toBeNull();
  });

  it("shows validation outputs to plugin managers above the detail tabs", async () => {
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
          vtAnalysis: null,
          llmAnalysis: null,
          staticScan: null,
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

    expect(screen.getByRole("region", { name: "Validation findings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Validation findings", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Validation/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "2 warnings" })).toBeNull();
    expect(screen.getByText("clawhub package validate <path-to-plugin>")).toBeTruthy();
    expect(screen.getByText(/Run locally/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy validate command" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy agent fix prompt" })).toBeTruthy();
    expect(screen.getByText("legacy-before-agent-start")).toBeTruthy();
    expect(screen.getByText(/Warning · Deprecated API · P2/)).toBeTruthy();
    expect(screen.queryByText("deprecation-warning")).toBeNull();
    expect(screen.queryByText("missing-expected-seam")).toBeNull();
    expect(screen.queryByText("registerTool is no longer available")).toBeNull();
    expect(screen.queryByText("Inspector")).toBeNull();
    expect(screen.queryByText("Scan")).toBeNull();
    expect(screen.getByRole("link", { name: "View fix guide ↗" }).getAttribute("href")).toBe(
      "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-before-agent-start",
    );
    expect(screen.getByText(/Release v1\.0\.0 · Target OpenClaw 0\.9\.0/)).toBeTruthy();
    expect(screen.getByText(/Legacy before_agent_start hook is deprecated\./)).toBeTruthy();
    expect(screen.getByText(/No blocking errors\. 1 warning should be reviewed\./)).toBeTruthy();
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
    expect(result.versions).toBeNull();
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
    vi.mocked(fetchPackageVersions).mockRejectedValueOnce(new Error("versions unavailable"));

    const result = await loader({ params: { name: "demo-plugin" } });

    expect(result.readme).toBe("README");
    expect(result.version).toEqual({ package: null, version: null });
    expect(result.versions).toBeNull();
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
    vi.mocked(fetchPackageVersions).mockRejectedValueOnce({ status: 429, retryAfterSeconds: 11 });

    const result = await loader({ params: { name: "demo-plugin" } });

    expect(result.version).toBe(latestVersion);
    expect(result.readme).toBe("README");
    expect(result.versions).toBeNull();
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
    expect(fetchPackageReadmeMock).toHaveBeenCalledWith("@openclaw/matrix");
    expect(fetchPackageVersionMock).toHaveBeenCalledWith("@openclaw/matrix", "2026.3.22");
    expect(fetchPackageVersions).toHaveBeenCalledWith("@openclaw/matrix", { limit: 20 });
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
    expect(fetchPackageReadmeMock).toHaveBeenCalledWith("@openclaw/anthropic-provider");
    expect(fetchPackageVersionMock).toHaveBeenCalledWith(
      "@openclaw/anthropic-provider",
      "2026.3.22",
    );
  });
});
