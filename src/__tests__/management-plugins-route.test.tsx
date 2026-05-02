/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: { component: unknown }) => ({
    __config: config,
    __path: path,
  }),
  Outlet: () => <div data-testid="outlet" />,
  Link: ({
    children,
    to,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
  }) => <a href={to}>{children}</a>,
  useRouterState: () => "/management/plugins",
}));

const useQueryMock = vi.fn();
const useAuthStatusMock = vi.fn();

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

import { PluginManagementRoute, Route } from "../routes/management/plugins";

function renderRoute() {
  render(createElement(PluginManagementRoute as never));
}

describe("plugin management route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useAuthStatusMock.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:mod", role: "moderator" },
    });
    useQueryMock.mockReturnValue({
      status: "needs-review",
      limit: 30,
      hasMore: false,
      items: [
        {
          packageId: "packages:1",
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          ownerHandle: "openclaw",
          summary: "A demo plugin.",
          latestVersion: "1.2.3",
          runtimeId: "demo.plugin",
          executesCode: true,
          verificationTier: "structural",
          clawpackAvailable: true,
          hostTargetKeys: ["darwin-arm64", "linux-x64-glibc"],
          environmentFlags: ["network", "desktop"],
          scanStatus: "suspicious",
          updatedAt: Date.UTC(2026, 0, 2),
          latestRelease: {
            releaseId: "packageReleases:1",
            version: "1.2.3",
            createdAt: Date.UTC(2026, 0, 1),
            clawpackAvailable: true,
            clawpackSha256: "a".repeat(64),
            clawpackFileCount: 4,
            source: {
              repo: "openclaw/demo-plugin",
              ref: "refs/tags/v1.2.3",
              path: ".",
            },
            verificationScanStatus: "suspicious",
          },
        },
      ],
    });
  });

  it("registers the dedicated plugin management route", () => {
    expect(Route).toBeTruthy();
  });

  it("renders plugin queue rows with management drilldown links", () => {
    renderRoute();

    expect(screen.getByRole("heading", { name: "Plugin management" })).toBeTruthy();
    expect(screen.getByText("Plugin operations")).toBeTruthy();
    expect(screen.getByText("/management/plugins")).toBeTruthy();
    expect(screen.getByText("Demo Plugin")).toBeTruthy();
    expect(screen.getByText("suspicious")).toBeTruthy();
    expect(screen.getByText("4 files / aaaaaaaaaaaa")).toBeTruthy();
    expect(screen.getByText("openclaw/demo-plugin / refs/tags/v1.2.3 / .")).toBeTruthy();
    expect(screen.getByText("darwin-arm64, linux-x64-glibc")).toBeTruthy();
    expect(screen.getByText("network, desktop")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage" }).getAttribute("href")).toBe(
      "/management/plugins/$name",
    );
  });

  it("updates the query status filter", () => {
    renderRoute();

    fireEvent.change(screen.getByDisplayValue("Needs review"), { target: { value: "clean" } });

    expect(useQueryMock).toHaveBeenLastCalledWith(expect.anything(), {
      status: "clean",
      limit: 30,
    });
  });

  it("blocks non-staff users", () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:member", role: "user" },
    });

    renderRoute();

    expect(screen.getByText("Management access required")).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), "skip");
  });
});
