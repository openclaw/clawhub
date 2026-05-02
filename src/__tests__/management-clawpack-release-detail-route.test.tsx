/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: { component: unknown }) => ({
    __config: config,
    __path: path,
    useParams: () => ({ releaseId: "packageReleases:1" }),
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
  Route,
  ClawPackReleaseDetailPage,
} from "../routes/management/clawpacks/releases/$releaseId";

function renderRoute() {
  render(
    createElement(ClawPackReleaseDetailPage as never, {
      releaseId: "packageReleases:1",
    }),
  );
}

describe("Claw Pack release detail route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useAuthStatusMock.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:mod", role: "moderator" },
    });
    useQueryMock.mockReturnValue({
      package: {
        packageId: "packages:1",
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        channel: "community",
        isOfficial: true,
        scanStatus: "clean",
        updatedAt: Date.UTC(2026, 0, 2),
      },
      release: {
        releaseId: "packageReleases:1",
        version: "1.2.3",
        createdAt: Date.UTC(2026, 0, 1),
        fileCount: 2,
        fileSample: [
          { path: "SKILL.md", size: 1200, sha256: "c".repeat(64) },
          { path: "plugin.json", size: 400, sha256: "d".repeat(64) },
        ],
        clawpackStorageId: "storage:1",
        clawpackSha256: "a".repeat(64),
        clawpackSize: 4096,
        clawpackSpecVersion: 1,
        clawpackFormat: "zip",
        clawpackFileCount: 2,
        clawpackManifestSha256: "b".repeat(64),
        clawpackBuiltAt: Date.UTC(2026, 0, 3),
        clawpackBuildVersion: "clawhub-clawpack-v1",
        clawpackRevokedAt: null,
        clawpackRevocationReason: null,
        hostTargetsSummary: [{ os: "darwin", arch: "arm64" }],
        environmentSummary: { requiresNetwork: true, requiresExternalServices: ["opik"] },
        source: {
          kind: "git",
          repo: "openclaw/demo-plugin",
          url: null,
          ref: "refs/tags/v1.2.3",
          commit: "abcdef1234567890",
          path: ".",
        },
        verificationScanStatus: "clean",
        vtStatus: "clean",
        vtVerdict: "clean",
        llmStatus: "clean",
        llmVerdict: "clean",
        staticScanStatus: "clean",
        staticScanSummary: "No findings",
        staticScanReasonCodes: [],
      },
      artifacts: [
        {
          artifactId: "packageReleaseArtifacts:1",
          kind: "clawpack",
          targetKey: null,
          storageId: "storage:1",
          sha256: "a".repeat(64),
          size: 4096,
          format: "zip",
          status: "active",
          createdAt: Date.UTC(2026, 0, 3),
          revokedAt: null,
          revocationReason: null,
        },
      ],
      failures: [
        {
          failureId: "packageClawPackBackfillFailures:1",
          error: "previous zip build failed",
          attemptCount: 2,
          firstFailedAt: Date.UTC(2026, 0, 1),
          lastAttemptAt: Date.UTC(2026, 0, 2),
          lastFailedAt: Date.UTC(2026, 0, 2),
          resolvedAt: Date.UTC(2026, 0, 3),
        },
      ],
      searchIndexRows: [
        {
          rowId: "packageClawPackSearchIndex:1",
          kind: "host-target",
          key: "darwin-arm64",
          updatedAt: Date.UTC(2026, 0, 3),
          createdAt: Date.UTC(2026, 0, 3),
        },
      ],
    });
  });

  it("registers the release drilldown route", () => {
    expect(Route).toBeTruthy();
  });

  it("renders release artifact, failure, index, and provenance evidence", () => {
    renderRoute();

    expect(screen.getByRole("heading", { name: "Claw Pack release detail" })).toBeTruthy();
    expect(screen.getByText("Demo Plugin")).toBeTruthy();
    expect(screen.getByText("demo-plugin")).toBeTruthy();
    expect(screen.getByText("Artifact rows")).toBeTruthy();
    expect(screen.getByText("Failure ledger")).toBeTruthy();
    expect(screen.getByText("Lookup index")).toBeTruthy();
    expect(screen.getAllByText("previous zip build failed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("darwin-arm64").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("service:opik")).toBeTruthy();
    expect(
      screen.getByText("openclaw/demo-plugin / refs/tags/v1.2.3 / . / abcdef123456"),
    ).toBeTruthy();
    expect(screen.getByText("SKILL.md")).toBeTruthy();
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
