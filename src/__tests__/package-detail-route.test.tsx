/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
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

type PluginDetailLoaderData = {
  detail: PackageDetailResponse;
  version: PackageVersionDetail | null;
  readme: string | null;
  rateLimited:
    | {
        scope: "detail" | "metadata";
        retryAfterSeconds: number | null;
      }
    | null;
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

vi.mock("../lib/packageApi", () => ({
  fetchPackageDetail: vi.fn(),
  fetchPackageReadme: vi.fn(),
  fetchPackageVersion: vi.fn(),
  isRateLimitedPackageApiError: (error: unknown) => isRateLimitedPackageApiErrorMock(error),
  getPackageDownloadPath: vi.fn((name: string, version?: string | null) =>
    version
      ? `/api/v1/packages/${name}/download?version=${version}`
      : `/api/v1/packages/${name}/download`,
  ),
}));

vi.mock("../components/MarkdownPreview", () => ({
  MarkdownPreview: ({ children }: { children: string; className?: string; highlight?: boolean }) => <div>{children}</div>,
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
  });

  it("hides download actions when the plugin has no latest release", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByText(/Latest release:/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Download zip" })).toBeNull();
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

    expect(screen.getByText("Security Scan")).toBeTruthy();
    expect(screen.getAllByText("VirusTotal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OpenClaw").length).toBeGreaterThan(0);
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

  it("falls back to the official scoped package name for short plugin routes", async () => {
    const route = await loadRoute();
    const loader = route.__config.loader as ({
      params,
    }: {
      params: { name: string };
    }) => Promise<PluginDetailLoaderData>;
    const fetchPackageDetailMock = vi.mocked(fetchPackageDetail);
    const fetchPackageReadmeMock = vi.mocked(fetchPackageReadme);
    const fetchPackageVersionMock = vi.mocked(fetchPackageVersion);

    fetchPackageDetailMock
      .mockResolvedValueOnce({ package: null, owner: null })
      .mockResolvedValueOnce({
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

    expect(fetchPackageDetailMock).toHaveBeenNthCalledWith(1, "matrix");
    expect(fetchPackageDetailMock).toHaveBeenNthCalledWith(2, "@openclaw/matrix");
    expect(fetchPackageReadmeMock).toHaveBeenCalledWith("@openclaw/matrix");
    expect(fetchPackageVersionMock).toHaveBeenCalledWith("@openclaw/matrix", "2026.3.22");
    expect(result.detail.package?.name).toBe("@openclaw/matrix");
    expect(result.rateLimited).toBeNull();
  });
});
