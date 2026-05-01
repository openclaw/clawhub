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
  useRouterState: () => "/management/storepacks",
}));

const useQueryMock = vi.fn();
const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const useAuthStatusMock = vi.fn();
const startMigrationRun = vi.fn();
const continueMigrationRun = vi.fn();

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: () => useActionMock(),
  useMutation: () => useMutationMock(),
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
    useMutationMock.mockReset();
    useAuthStatusMock.mockReset();
    startMigrationRun.mockReset();
    continueMigrationRun.mockReset();

    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:admin", role: "admin" },
    });
    useActionMock.mockReturnValue(continueMigrationRun);
    useMutationMock.mockReturnValue(startMigrationRun);

    const migrationStatus = {
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
    };
    const migrationRunList = {
      items: [
        {
          _id: "storePackMigrationRuns:1",
          actorUserId: "users:admin",
          operation: "failure-retry",
          status: "pending",
          limit: 10,
          processed: 0,
          generated: 0,
          skipped: 0,
          failed: 0,
          bytesGenerated: 0,
          failureCounts: {},
          createdAt: Date.UTC(2026, 0, 3),
          updatedAt: Date.UTC(2026, 0, 3),
          actor: { userId: "users:admin", handle: "admin", name: "Admin", role: "admin" },
        },
      ],
      limit: 12,
      status: null,
      hasMore: false,
    };
    const dryRunResult = {
      operation: "artifact-backfill",
      limit: 10,
      cursor: null,
      continueCursor: null,
      isDone: false,
      candidates: migrationStatus.missingSample,
      candidateCount: 1,
      failureCount: 1,
    };
    useQueryMock.mockImplementation((_ref: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "operation" in args) return dryRunResult;
      if (args && typeof args === "object" && "limit" in args) return migrationRunList;
      return migrationStatus;
    });
  });

  it("registers the dedicated management route", () => {
    expect(Route).toBeTruthy();
  });

  it("renders migration status and dry-run sample rows", () => {
    renderRoute();

    expect(screen.getByRole("heading", { name: "StorePack operations" })).toBeTruthy();
    expect(screen.getByText("Plugin operations")).toBeTruthy();
    expect(screen.getByText("/publish-plugin")).toBeTruthy();
    expect(screen.getByText("/management/moderation")).toBeTruthy();
    expect(screen.getByText("/management/migrations")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("4.0KB")).toBeTruthy();
    expect(screen.getByText("Failed artifact builds")).toBeTruthy();
    expect(screen.getByText(/Invalid StorePack file path/)).toBeTruthy();
    expect(screen.getByText("Create migration run")).toBeTruthy();
    expect(screen.getByText("Run next batch")).toBeTruthy();
    expect(screen.getByText("Migration runs")).toBeTruthy();
    expect(screen.getAllByText("Details").length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole("button", { name: "Dry-run operation" }));

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
    expect(screen.queryByText("Create migration run")).toBeNull();
    expect(screen.queryByText("Run next batch")).toBeNull();
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

  it("confirms and creates migration runs for admins", async () => {
    startMigrationRun.mockResolvedValueOnce({
      _id: "storePackMigrationRuns:2",
      operation: "artifact-backfill",
      status: "pending",
    });
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Create migration run" }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Create a artifact backfill migration run"),
    );
    expect(startMigrationRun).toHaveBeenCalledWith({ operation: "artifact-backfill", limit: 10 });
    expect(await screen.findByText(/created storePackMigrationRuns:2/i)).toBeTruthy();
  });

  it("confirms and continues migration run batches for admins", async () => {
    continueMigrationRun.mockResolvedValueOnce({
      run: {
        _id: "storePackMigrationRuns:1",
        operation: "failure-retry",
        status: "completed",
      },
      result: { processed: 1, succeeded: 1, failed: 0 },
    });
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Run next batch" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Run next failure retry"));
    expect(continueMigrationRun).toHaveBeenCalledWith({ runId: "storePackMigrationRuns:1" });
    expect(await screen.findByText(/processed 1 - succeeded 1 - failed 0/i)).toBeTruthy();
  });
});
