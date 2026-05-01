/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: { component: unknown }) => ({
    __config: config,
    __path: path,
    useParams: () => ({ bundledPluginId: "opik" }),
  }),
  Link: ({
    children,
    to,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
  }) => <a href={to}>{children}</a>,
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

import {
  OfficialMigrationDetailPage,
  Route,
} from "../routes/management/migrations/$bundledPluginId";

function renderDetail(bundledPluginId = "opik") {
  render(createElement(OfficialMigrationDetailPage as never, { bundledPluginId }));
}

describe("official migration readiness detail route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useAuthStatusMock.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:mod", role: "moderator" },
    });
    useQueryMock.mockReturnValue({
      readyCount: 0,
      blockedCount: 1,
      generatedAt: Date.UTC(2026, 4, 1),
      items: [
        {
          bundledPluginId: "opik",
          displayName: "Opik",
          desiredPackageName: "@opik/opik-openclaw",
          publisherHandle: "opik",
          sourceRepo: "comet-ml/opik-openclaw",
          sourcePath: "packages/openclaw",
          sourceCommit: "abc1234567890",
          sourceRef: null,
          requiredHostTargets: ["darwin-arm64", "linux-x64-glibc", "win32-x64"],
          readinessState: "metadata-incomplete",
          blockers: ["environment-metadata-incomplete"],
          gates: {
            packageExists: true,
            releaseExists: true,
            storepackAvailable: true,
            hostMatrixComplete: true,
            environmentComplete: false,
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
            storepackSha256: "b".repeat(64),
            storepackFileCount: 8,
            hostTargetKeys: ["darwin-arm64", "linux-x64-glibc", "win32-x64"],
            environmentFlags: [],
            scanStatus: "clean",
          },
        },
      ],
    });
  });

  it("registers the migration candidate route", () => {
    expect(Route).toBeTruthy();
  });

  it("renders one candidate with gate evidence and blockers", () => {
    renderDetail();

    expect(screen.getByRole("heading", { name: "Migration candidate" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Opik" })).toBeTruthy();
    expect(screen.getByText("metadata incomplete")).toBeTruthy();
    expect(screen.getByText("8 files / bbbbbbbbbbbb")).toBeTruthy();
    expect(screen.getByText("packages/openclaw")).toBeTruthy();
    expect(screen.getByText("Environment complete")).toBeTruthy();
    expect(screen.getAllByText("blocked").length).toBeGreaterThan(0);
    expect(screen.getByText("environment metadata incomplete")).toBeTruthy();
  });

  it("shows a not found state for unknown candidates", () => {
    renderDetail("missing");

    expect(screen.getByText("not found")).toBeTruthy();
    expect(screen.getByText("missing")).toBeTruthy();
  });

  it("explains missing management role for non-staff users", () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:member", role: "user" },
    });

    renderDetail();

    expect(screen.getByText("Management access required")).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), "skip");
  });
});
