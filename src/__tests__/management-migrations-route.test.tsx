/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
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
  useRouterState: () => "/management/migrations",
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

import { OfficialMigrationRoute, Route } from "../routes/management/migrations";

function renderRoute() {
  render(createElement(OfficialMigrationRoute as never));
}

describe("official migration readiness route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useAuthStatusMock.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:mod", role: "moderator" },
    });
    useQueryMock.mockReturnValue({
      readyCount: 1,
      blockedCount: 1,
      generatedAt: Date.UTC(2026, 4, 1),
      items: [
        {
          bundledPluginId: "opik",
          displayName: "Opik",
          desiredPackageName: "@opik/opik-openclaw",
          publisherHandle: "opik",
          sourceRepo: "comet-ml/opik-openclaw",
          sourcePath: ".",
          sourceCommit: "abc1234567890",
          sourceRef: null,
          requiredHostTargets: ["darwin-arm64", "linux-x64-glibc", "win32-x64"],
          readinessState: "ready-for-openclaw",
          blockers: [],
          gates: {
            packageExists: true,
            releaseExists: true,
            clawpackAvailable: true,
            hostMatrixComplete: true,
            environmentComplete: true,
            sourceLinked: true,
            scanClear: true,
            runtimeBundleStatus: "not-required",
          },
          package: {
            packageId: "packages:1",
            name: "@opik/opik-openclaw",
            displayName: "Opik",
            family: "code-plugin",
            runtimeId: "opik",
            channel: "official",
            isOfficial: true,
            scanStatus: "clean",
            updatedAt: Date.UTC(2026, 4, 1),
          },
          latestRelease: {
            releaseId: "packageReleases:1",
            version: "1.0.0",
            createdAt: Date.UTC(2026, 4, 1),
            clawpackSha256: "a".repeat(64),
            clawpackFileCount: 5,
            hostTargetKeys: ["darwin-arm64", "linux-x64-glibc", "win32-x64"],
            environmentFlags: ["network"],
            scanStatus: "clean",
          },
        },
        {
          bundledPluginId: "qqbot",
          displayName: "QQbot",
          desiredPackageName: "@tencent-connect/openclaw-qqbot",
          publisherHandle: "tencent-connect",
          sourceRepo: "tencent-connect/openclaw-qqbot",
          sourcePath: ".",
          sourceCommit: null,
          sourceRef: null,
          requiredHostTargets: ["darwin-arm64", "linux-x64-glibc", "win32-x64"],
          readinessState: "clawpack-missing",
          blockers: ["clawpack-missing", "source-ref-missing"],
          gates: {
            packageExists: true,
            releaseExists: true,
            clawpackAvailable: false,
            hostMatrixComplete: false,
            environmentComplete: false,
            sourceLinked: false,
            scanClear: false,
            runtimeBundleStatus: "not-required",
          },
          package: {
            packageId: "packages:2",
            name: "@tencent-connect/openclaw-qqbot",
            displayName: "QQbot",
            family: "code-plugin",
            runtimeId: "qqbot",
            channel: "community",
            isOfficial: false,
            scanStatus: "pending",
            updatedAt: Date.UTC(2026, 4, 1),
          },
          latestRelease: {
            releaseId: "packageReleases:2",
            version: "1.0.0",
            createdAt: Date.UTC(2026, 4, 1),
            clawpackSha256: null,
            clawpackFileCount: null,
            hostTargetKeys: [],
            environmentFlags: [],
            scanStatus: "pending",
          },
        },
      ],
    });
  });

  it("registers the dedicated migrations route", () => {
    expect(Route).toBeTruthy();
  });

  it("renders readiness counts, gates, blockers, and deep links", () => {
    renderRoute();

    expect(screen.getByRole("heading", { name: "OpenClaw migration readiness" })).toBeTruthy();
    expect(screen.getByText("Plugin operations")).toBeTruthy();
    expect(screen.getByText("/publish-plugin")).toBeTruthy();
    expect(screen.getByText("/management/moderation")).toBeTruthy();
    expect(screen.getByText("/management/clawpacks")).toBeTruthy();
    expect(screen.getByText("Opik")).toBeTruthy();
    expect(screen.getByText("QQbot")).toBeTruthy();
    expect(screen.getByText("ready for openclaw")).toBeTruthy();
    expect(screen.getByText("claw pack missing")).toBeTruthy();
    expect(screen.getByText("5 files / aaaaaaaaaaaa")).toBeTruthy();
    expect(screen.getByText(/claw pack missing, source ref missing/i)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Plugin page" })[0]?.getAttribute("href")).toBe(
      "/plugins/$name",
    );
    expect(screen.getAllByRole("link", { name: "Details" })[0]?.getAttribute("href")).toBe(
      "/management/migrations/$bundledPluginId",
    );
  });

  it("explains missing management role for non-staff users", () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:member", role: "user" },
    });

    renderRoute();

    expect(screen.getByText("Management access required")).toBeTruthy();
    expect(screen.getByText(/role user/i)).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), "skip");
  });
});
