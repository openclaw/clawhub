/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchPackageDetail,
  fetchPackageReadme,
  fetchPackageVersion,
  type PackageDetailResponse,
  type PackageVersionDetail,
} from "../lib/packageApi";

const isRateLimitedPackageApiErrorMock = vi.fn(
  (error: unknown) =>
    typeof error === "object" && error !== null && (error as { status?: number }).status === 429,
);
const useQueryMock = vi.fn();
const useAuthStatusMock = vi.fn();

type PluginDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  readme: string | null;
  rateLimited: {
    scope: "detail" | "metadata";
    retryAfterSeconds: number | null;
  } | null;
};

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
      capabilities: { executesCode: true, capabilityTags: ["tools"] },
      verification: null,
    },
    owner: null,
  },
  version: null,
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
  }) =>
    select
      ? select({ location: { pathname: `/plugins/${paramsMock.name}` } })
      : `/plugins/${paramsMock.name}`,
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
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => vi.fn(),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("../lib/packageApi", () => ({
  fetchPackageDetail: vi.fn(),
  fetchPackageReadme: vi.fn(),
  fetchPackageVersion: vi.fn(),
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

describe("plugin detail route", () => {
  beforeEach(() => {
    paramsMock = { name: "demo-plugin" };
    vi.mocked(fetchPackageDetail).mockReset();
    vi.mocked(fetchPackageReadme).mockReset();
    vi.mocked(fetchPackageVersion).mockReset();
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
          capabilities: { executesCode: true, capabilityTags: ["tools"] },
          verification: null,
        },
        owner: null,
      },
      version: null,
      readme: null,
      rateLimited: null,
    };
    isRateLimitedPackageApiErrorMock.mockClear();
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue(undefined);
    useAuthStatusMock.mockReset();
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    });
  });

  it("hides download actions when the plugin has no latest release", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByText(/Latest release:/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Download zip" })).toBeNull();
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
      container.querySelector('nav[aria-label="Plugin breadcrumbs"] a[href="/user/openclaw"]'),
    ).toBeTruthy();
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
    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
  });

  it("renders plugin download counts in the metadata sidebar", async () => {
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

    const downloadsLabel = screen.getByText("Downloads");
    const currentVersionLabel = screen.getByText("Current version");
    expect(downloadsLabel.compareDocumentPosition(currentVersionLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("1.2k")).toBeTruthy();
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
          capabilities: null,
          verification: null,
          sha256hash: null,
          vtAnalysis: null,
          llmAnalysis: null,
          staticScan: null,
        },
      },
      readme: null,
      rateLimited: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const downloadLink = screen.getByRole("link", { name: /download/i });
    const newVersionLink = screen.getByRole("link", { name: "New version" });
    expect(newVersionLink.getAttribute("href")).toBe(
      "/plugins/publish?ownerHandle=demo-owner&name=demo-plugin&displayName=Demo+Plugin",
    );
    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
    expect(
      downloadLink.compareDocumentPosition(newVersionLink) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
          capabilities: null,
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
    const capabilitiesTab = screen.getByRole("tab", { name: "Capabilities" });
    const securityAuditLabelIndex = sidebarLabels.findIndex((label) =>
      label?.startsWith("Security audit"),
    );
    expect(securityAuditLabelIndex).toBeGreaterThanOrEqual(0);
    expect(securityAuditLabelIndex).toBeGreaterThan(sidebarLabels.indexOf("Downloads"));
    fireEvent.click(capabilitiesTab);
    expect(screen.getByText("Tags")).toBeTruthy();
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
          capabilities: null,
          verification: null,
          sha256hash: "a".repeat(64),
          vtAnalysis: null,
          llmAnalysis: null,
          staticScan: null,
        },
      },
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
          capabilities: null,
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
          capabilities: null,
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

  it("shows a retryable empty state when the detail lookup is rate limited", async () => {
    loaderDataMock = {
      detail: { package: null, owner: null },
      version: null,
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
        capabilities: null,
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
    expect(result.rateLimited).toEqual({
      scope: "metadata",
      retryAfterSeconds: 11,
    });
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
        capabilities: null,
        verification: null,
      },
      owner: { handle: "openclaw", displayName: "OpenClaw", image: null },
    });
    fetchPackageReadmeMock.mockResolvedValueOnce("README");
    fetchPackageVersionMock.mockResolvedValueOnce({ package: null, version: null });

    const result = await loader({ params: { name: "matrix" } });

    expect(fetchPackageDetailMock).toHaveBeenCalledTimes(1);
    expect(fetchPackageDetailMock).toHaveBeenCalledWith("@openclaw/matrix");
    expect(fetchPackageReadmeMock).toHaveBeenCalledWith("@openclaw/matrix");
    expect(fetchPackageVersionMock).toHaveBeenCalledWith("@openclaw/matrix", "2026.3.22");
    expect(result.detail.package?.name).toBe("@openclaw/matrix");
    expect(result.rateLimited).toBeNull();
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
        capabilities: null,
        verification: null,
      },
      owner: { handle: "openclaw", displayName: "OpenClaw", image: null },
    });
    fetchPackageReadmeMock.mockResolvedValueOnce("README");
    fetchPackageVersionMock.mockResolvedValueOnce({ package: null, version: null });

    const result = await loader({ params: { name: "anthropic" } });

    expect(fetchPackageDetailMock).toHaveBeenCalledTimes(1);
    expect(fetchPackageDetailMock).toHaveBeenCalledWith("@openclaw/anthropic-provider");
    expect(fetchPackageReadmeMock).toHaveBeenCalledWith("@openclaw/anthropic-provider");
    expect(fetchPackageVersionMock).toHaveBeenCalledWith(
      "@openclaw/anthropic-provider",
      "2026.3.22",
    );
    expect(result.detail.package?.name).toBe("@openclaw/anthropic-provider");
  });
});
