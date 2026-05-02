/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: { component: unknown }) => ({
    __config: config,
    __path: path,
    useParams: () => ({ name: "demo-plugin" }),
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
const useMutationMock = vi.fn();
const useAuthStatusMock = vi.fn();
const setBatch = vi.fn();
const setVerdict = vi.fn();
const revokeClawPack = vi.fn();

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => useMutationMock(),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

import { PluginManagementDetailPage, Route } from "../routes/management/plugins/$name";

function renderRoute() {
  render(createElement(PluginManagementDetailPage as never, { name: "demo-plugin" }));
}

describe("plugin management detail route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useAuthStatusMock.mockReset();
    setBatch.mockReset();
    setVerdict.mockReset();
    revokeClawPack.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:mod", role: "moderator" },
    });
    useMutationMock.mockReturnValue((args: Record<string, unknown>) => {
      if ("releaseId" in args) return revokeClawPack(args);
      if ("verdict" in args) return setVerdict(args);
      return setBatch(args);
    });
    setBatch.mockResolvedValue({ ok: true });
    setVerdict.mockResolvedValue({ ok: true });
    revokeClawPack.mockResolvedValue({ ok: true });
    useQueryMock.mockReturnValue({
      package: {
        _id: "packages:1",
        _creationTime: 1,
        name: "demo-plugin",
        normalizedName: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        ownerUserId: "users:owner",
        summary: "A demo plugin.",
        tags: {},
        latestReleaseId: "packageReleases:1",
        latestVersion: "1.2.3",
        executesCode: true,
        runtimeId: "demo.plugin",
        verification: { tier: "structural" },
        scanStatus: "suspicious",
        stats: {},
        createdAt: Date.UTC(2026, 0, 1),
        updatedAt: Date.UTC(2026, 0, 2),
      },
      latestRelease: {
        _id: "packageReleases:1",
        _creationTime: 1,
        packageId: "packages:1",
        version: "1.2.3",
        files: [],
        tags: ["latest"],
        createdAt: Date.UTC(2026, 0, 1),
        clawpackStorageId: "storage:1",
        clawpackSha256: "a".repeat(64),
        clawpackManifestSha256: "b".repeat(64),
        clawpackFileCount: 4,
        clawpackSize: 4096,
        clawpackBuiltAt: Date.UTC(2026, 0, 3),
        hostTargetsSummary: [{ os: "darwin", arch: "arm64" }],
        environmentSummary: { requiresNetwork: true, requiresExternalServices: ["opik"] },
        source: {
          repo: "openclaw/demo-plugin",
          ref: "refs/tags/v1.2.3",
          path: ".",
          commit: "abcdef1234567890",
        },
        verification: { scanStatus: "suspicious" },
        staticScan: { status: "suspicious" },
        vtAnalysis: { status: "clean" },
        llmAnalysis: { status: "clean" },
      },
      owner: { handle: "openclaw" },
      highlighted: null,
    });
  });

  it("registers the dedicated plugin detail route", () => {
    expect(Route).toBeTruthy();
  });

  it("renders package, Claw Pack, and release provenance details", () => {
    renderRoute();

    expect(screen.getByRole("heading", { name: "Plugin package detail" })).toBeTruthy();
    expect(screen.getByText("Demo Plugin")).toBeTruthy();
    expect(screen.getByText("demo.plugin")).toBeTruthy();
    expect(screen.getByText(/active /)).toBeTruthy();
    expect(
      screen.getByText("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toBeTruthy();
    expect(
      screen.getByText("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    ).toBeTruthy();
    expect(screen.getByText("darwin-arm64")).toBeTruthy();
    expect(screen.getByText("network, service:opik")).toBeTruthy();
    expect(
      screen.getByText("openclaw/demo-plugin / refs/tags/v1.2.3 / . / abcdef123456"),
    ).toBeTruthy();
  });

  it("confirms and writes moderation verdicts", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    renderRoute();

    fireEvent.change(screen.getByPlaceholderText("Required"), {
      target: { value: "reviewed clawpack and source" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(setVerdict).toHaveBeenCalledWith({
        packageId: "packages:1",
        verdict: "suspicious",
        note: "reviewed clawpack and source",
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("writes a package moderation verdict and audit log in Convex"),
    );
  });

  it("requires a revocation reason before Claw Pack writes", async () => {
    vi.spyOn(window, "prompt").mockReturnValueOnce("bad artifact");
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Revoke Claw Pack" }));

    await waitFor(() => {
      expect(revokeClawPack).toHaveBeenCalledWith({
        releaseId: "packageReleases:1",
        reason: "bad artifact",
      });
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
