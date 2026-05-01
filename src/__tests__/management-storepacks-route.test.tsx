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
const useActionMock = vi.fn();
const useAuthStatusMock = vi.fn();
const backfillArtifacts = vi.fn();
const backfillIndex = vi.fn();
const retryFailures = vi.fn();

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: () => useActionMock(),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

import { Route, StorePackManagementRoute } from "../routes/management/storepacks";

function renderRoute() {
  render(createElement(StorePackManagementRoute as never));
}

describe("StorePack management route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useActionMock.mockReset();
    useAuthStatusMock.mockReset();
    backfillArtifacts.mockReset();
    backfillIndex.mockReset();
    retryFailures.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:admin", role: "admin" },
    });
    useActionMock
      .mockReturnValueOnce(backfillArtifacts)
      .mockReturnValueOnce(backfillIndex)
      .mockReturnValueOnce(retryFailures);
    useQueryMock.mockReturnValue({
      missingSample: [
        {
          releaseId: "packageReleases:1",
          packageId: "packages:1",
          name: "demo-plugin",
          displayName: "Demo Plugin",
          version: "1.2.3",
          createdAt: Date.UTC(2026, 0, 1),
          fileCount: 3,
        },
      ],
      failureSample: [
        {
          failureId: "packageStorePackBackfillFailures:1",
          releaseId: "packageReleases:2",
          packageId: "packages:2",
          name: "broken-plugin",
          version: "0.1.0",
          error: "Invalid StorePack file path",
          attemptCount: 2,
          firstFailedAt: Date.UTC(2026, 0, 1),
          lastAttemptAt: Date.UTC(2026, 0, 2),
          lastFailedAt: Date.UTC(2026, 0, 2),
        },
      ],
      missingSampleSize: 1,
      failureSampleSize: 1,
      generatedStorePackSampleSize: 3,
      generatedStorePackBytes: 4096,
      sampleLimit: 25,
    });
  });

  it("registers the dedicated management route", () => {
    expect(Route).toBeTruthy();
  });

  it("renders migration status and dry-run sample rows", () => {
    renderRoute();

    expect(screen.getByRole("heading", { name: "StorePack operations" })).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("4.0KB")).toBeTruthy();
    expect(screen.getByText("Failed artifact builds")).toBeTruthy();
    expect(screen.getByText(/Invalid StorePack file path/)).toBeTruthy();
    expect(screen.getByText("Build missing artifacts")).toBeTruthy();
    expect(screen.getByText("Retry failed builds")).toBeTruthy();
    expect(screen.getByText("Rebuild lookup index")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dry-run sample" }));

    expect(screen.getAllByText("Demo Plugin").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/demo-plugin@1\.2\.3/i).length).toBeGreaterThan(0);
  });

  it("hides write buttons for moderators without admin role", () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:mod", role: "moderator" },
    });

    renderRoute();

    expect(screen.getByText("read only")).toBeTruthy();
    expect(screen.queryByText("Build missing artifacts")).toBeNull();
    expect(screen.queryByText("Retry failed builds")).toBeNull();
    expect(screen.queryByText("Rebuild lookup index")).toBeNull();
  });

  it("confirms and runs failed build retries for admins", async () => {
    retryFailures.mockResolvedValueOnce({ processed: 1, succeeded: 1, failed: 0 });
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Retry failed builds" }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Retry failed StorePack artifact builds"),
    );
    expect(retryFailures).toHaveBeenCalledWith({ limit: 10 });
    expect(await screen.findByText(/processed 1 - succeeded 1 - failed 0/i)).toBeTruthy();
  });
});
