/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: { component: unknown }) => ({
    __config: config,
    __path: path,
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
const setVerdict = vi.fn();

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => useMutationMock(),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

import { PluginModerationRoute, Route } from "../routes/management/moderation";

function renderRoute() {
  render(createElement(PluginModerationRoute as never));
}

describe("plugin moderation route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useAuthStatusMock.mockReset();
    setVerdict.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:mod", role: "moderator" },
    });
    useMutationMock.mockReturnValue(setVerdict);
    setVerdict.mockResolvedValue({ ok: true });
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
          ownerKind: "org",
          summary: "A demo plugin.",
          latestVersion: "1.2.3",
          runtimeId: "demo.plugin",
          executesCode: true,
          verificationTier: "structural",
          storepackAvailable: true,
          hostTargetKeys: ["darwin-arm64", "linux-x64-glibc"],
          environmentFlags: ["network", "desktop"],
          scanStatus: "suspicious",
          updatedAt: Date.UTC(2026, 0, 2),
          latestRelease: {
            releaseId: "packageReleases:1",
            version: "1.2.3",
            createdAt: Date.UTC(2026, 0, 1),
            storepackAvailable: true,
            storepackSha256: "a".repeat(64),
            storepackFileCount: 4,
          },
        },
      ],
    });
  });

  it("registers the dedicated moderation route", () => {
    expect(Route).toBeTruthy();
  });

  it("renders plugin risk, StorePack, and compatibility context", () => {
    renderRoute();

    expect(screen.getByRole("heading", { name: "Plugin moderation" })).toBeTruthy();
    expect(screen.getByText("Demo Plugin")).toBeTruthy();
    expect(screen.getByText("suspicious")).toBeTruthy();
    expect(screen.getByText("Code Plugin")).toBeTruthy();
    expect(screen.getByText("4 files / aaaaaaaaaaaa")).toBeTruthy();
    expect(screen.getByText("darwin-arm64")).toBeTruthy();
    expect(screen.getByText("linux-x64-glibc")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage" }).getAttribute("href")).toBe("/management");
  });

  it("requires an audit note and confirms before writing a verdict", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("reviewed source and artifact");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Approve clean" }));

    await waitFor(() => {
      expect(setVerdict).toHaveBeenCalledWith({
        packageId: "packages:1",
        verdict: "clean",
        note: "reviewed source and artifact",
      });
    });
    expect(prompt).toHaveBeenCalledWith("Audit note for demo-plugin -> clean");
    expect(confirm.mock.calls[0]?.[0]).toContain(
      "writes a package moderation verdict and audit log in Convex",
    );

    prompt.mockRestore();
    confirm.mockRestore();
  });

  it("blocks non-staff users", () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:member", role: "user" },
    });

    renderRoute();

    expect(screen.getByText("Management only.")).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), "skip");
  });
});
