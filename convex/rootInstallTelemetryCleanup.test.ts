/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("./functions", () => ({
  internalAction: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalQuery: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    rootInstallTelemetryCleanup: {
      cleanupRootInstallTelemetryBatchInternal: Symbol("cleanupRootInstallTelemetryBatchInternal"),
    },
    skillStatEvents: {
      processSkillStatEventsAction: Symbol("processSkillStatEventsAction"),
      processSkillStatEventsInternal: Symbol("processSkillStatEventsInternal"),
    },
  },
}));

const {
  cleanupRootInstallTelemetryBatchHandler,
  cleanupRootInstallTelemetryHandler,
  ROOT_INSTALL_TELEMETRY_CLEANUP_CONFIRMATION,
} = await import("./rootInstallTelemetryCleanup");

describe("root install telemetry cleanup", () => {
  it("defaults to dry run and reports legacy active-root rows without changing them", async () => {
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          paginate: async () => ({
            page: [
              { _id: "installs:active", skillId: "skills:active", activeRoots: 2 },
              { _id: "installs:inactive", skillId: "skills:inactive", activeRoots: 0 },
              { _id: "installs:rootless", skillId: "skills:rootless" },
            ],
            continueCursor: "next",
            isDone: false,
          }),
        })),
        patch,
        insert,
        delete: vi.fn(),
      },
    };

    const result = await cleanupRootInstallTelemetryBatchHandler(ctx as never, {
      phase: "activeRoots",
      dryRun: true,
      batchSize: 3,
    });

    expect(result).toMatchObject({
      phase: "activeRoots",
      scanned: 3,
      matched: 2,
      reactivated: 1,
      dryRun: true,
      isDone: false,
      cursor: "next",
    });
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("strips activeRoots and reactivates only legacy inactive installs", async () => {
    const patch = vi.fn();
    const insert = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          paginate: async () => ({
            page: [
              { _id: "installs:active", skillId: "skills:active", activeRoots: 2 },
              { _id: "installs:inactive", skillId: "skills:inactive", activeRoots: 0 },
            ],
            continueCursor: null,
            isDone: true,
          }),
        })),
        patch,
        insert,
        delete: vi.fn(),
      },
    };

    const result = await cleanupRootInstallTelemetryBatchHandler(ctx as never, {
      phase: "activeRoots",
      dryRun: false,
      confirm: ROOT_INSTALL_TELEMETRY_CLEANUP_CONFIRMATION,
      batchSize: 2,
    });

    expect(result).toMatchObject({
      phase: "activeRoots",
      nextPhase: "rootInstalls",
      matched: 2,
      reactivated: 1,
      dryRun: false,
    });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenCalledWith("installs:active", { activeRoots: undefined });
    expect(patch).toHaveBeenCalledWith("installs:inactive", { activeRoots: undefined });
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(
      "skillStatEvents",
      expect.objectContaining({ skillId: "skills:inactive", kind: "install_reactivate" }),
    );
  });

  it("deletes legacy root rows during destructive table phases", async () => {
    const deleteDoc = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          paginate: async () => ({
            page: [{ _id: "rootInstalls:one" }, { _id: "rootInstalls:two" }],
            continueCursor: null,
            isDone: true,
          }),
        })),
        patch: vi.fn(),
        insert: vi.fn(),
        delete: deleteDoc,
      },
    };

    const result = await cleanupRootInstallTelemetryBatchHandler(ctx as never, {
      phase: "rootInstalls",
      dryRun: false,
      confirm: ROOT_INSTALL_TELEMETRY_CLEANUP_CONFIRMATION,
      batchSize: 2,
    });

    expect(result).toMatchObject({
      phase: "rootInstalls",
      nextPhase: "roots",
      scanned: 2,
      matched: 2,
      dryRun: false,
    });
    expect(deleteDoc).toHaveBeenCalledTimes(2);
    expect(deleteDoc).toHaveBeenCalledWith("rootInstalls:one");
    expect(deleteDoc).toHaveBeenCalledWith("rootInstalls:two");
  });

  it("requires an explicit confirmation token for destructive runs", async () => {
    await expect(
      cleanupRootInstallTelemetryHandler({ runMutation: vi.fn() } as never, {
        dryRun: false,
      }),
    ).rejects.toThrow(ROOT_INSTALL_TELEMETRY_CLEANUP_CONFIRMATION);
  });
});
