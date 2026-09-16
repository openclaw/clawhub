/* @vitest-environment node */

import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import {
  discardStalePackagePublishAttempts,
  discardStalePackagePublishAttemptsInternal,
  listStalePackagePublishAttemptsInternal,
} from "./maintenance";

const auth = vi.hoisted(() => ({ requireUserFromAction: vi.fn() }));
vi.mock("./lib/access", async (original) => ({
  ...(await original<typeof import("./lib/access")>()),
  requireUserFromAction: auth.requireUserFromAction,
}));

type Handler = { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> };
const list = (listStalePackagePublishAttemptsInternal as unknown as Handler)._handler;
const discard = (discardStalePackagePublishAttemptsInternal as unknown as Handler)._handler;
const discardAsAdmin = (discardStalePackagePublishAttempts as unknown as Handler)._handler;
const version = "2026.9.1";
const slugPrefix = "@openclaw/";

function attempt(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: `publishAttempts:${id}`,
    kind: "package",
    status: "pending_checks",
    packageId: `packages:${id}`,
    packageReleaseId: `packageReleases:${id}`,
    slug: `@openclaw/${id}`,
    version,
    createdAt: 123,
    createdNewParent: true,
    ...overrides,
  };
}

function queryCtx(rows: Record<string, unknown>[]) {
  const limits: number[] = [];
  const ctx = {
    db: {
      query: vi.fn((table: string) => {
        expect(table).toBe("publishAttempts");
        return {
          withIndex: (
            name: string,
            build: (q: { eq: (key: string, value: unknown) => unknown }) => unknown,
          ) => {
            expect(name).toBe("by_status_and_created");
            let requestedStatus: unknown;
            const q = {
              eq: (key: string, value: unknown) => {
                expect(key).toBe("status");
                requestedStatus = value;
                return q;
              },
            };
            build(q);
            return {
              take: async (limit: number) => {
                limits.push(limit);
                return rows.filter((row) => row.status === requestedStatus).slice(0, limit);
              },
            };
          },
        };
      }),
      get: vi.fn(async (id: string) => {
        if (id.startsWith("publishAttempts:")) return rows.find((row) => row._id === id) ?? null;
        if (id === "packageReleases:gone") return null;
        return { _id: id, publicationStatus: "pending" };
      }),
    },
  };
  return { ctx, limits };
}

function actionCtx(rows = [attempt("one"), attempt("gone", { status: "ready_to_finalize" })]) {
  const { ctx } = queryCtx(rows);
  return {
    runQuery: vi.fn(
      async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
        expect(getFunctionName(ref)).toBe("maintenance:listStalePackagePublishAttemptsInternal");
        return list(ctx, args);
      },
    ),
    runMutation: vi.fn(
      async (_ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => ({
        deleted: args.releaseId !== "packageReleases:gone",
        parentDeleted: true,
        retiredAttemptIds: [args.attemptId],
      }),
    ),
  };
}

describe("stale package publish attempt operations", () => {
  it("lists only matching package versions, prefixes and active statuses, including missing releases", async () => {
    const rows = [
      attempt("checks", { checkClaimLastError: "scanner error" }),
      attempt("gone", { status: "ready_to_finalize", finalizationLastError: "parent failed" }),
      attempt("finalizing", { status: "finalizing" }),
      attempt("skill", { kind: "skill" }),
      attempt("old", { version: "2026.8.1" }),
      attempt("other", { slug: "@other/plugin" }),
      ...["finalized", "failed", "blocked", "expired"].map((status) => attempt(status, { status })),
    ];
    const { ctx } = queryCtx(rows);
    await expect(list(ctx, { version, slugPrefix })).resolves.toEqual([
      {
        attemptId: "publishAttempts:checks",
        slug: "@openclaw/checks",
        version,
        status: "pending_checks",
        packageId: "packages:checks",
        releaseId: "packageReleases:checks",
        createdNewParent: true,
        createdAt: 123,
        lastError: "scanner error",
        releasePublicationStatus: "pending",
      },
      {
        attemptId: "publishAttempts:gone",
        slug: "@openclaw/gone",
        version,
        status: "ready_to_finalize",
        packageId: "packages:gone",
        releaseId: "packageReleases:gone",
        createdNewParent: true,
        createdAt: 123,
        lastError: "parent failed",
        releasePublicationStatus: null,
      },
      {
        attemptId: "publishAttempts:finalizing",
        slug: "@openclaw/finalizing",
        version,
        status: "finalizing",
        packageId: "packages:finalizing",
        releaseId: "packageReleases:finalizing",
        createdNewParent: true,
        createdAt: 123,
        lastError: null,
        releasePublicationStatus: "pending",
      },
    ]);
    expect(ctx.db.get).toHaveBeenCalledTimes(3);
  });

  it.each([
    [undefined, 200],
    [999, 500],
  ] as const)(
    "bounds large attempt reads with limit %s across all statuses",
    async (limit, expected) => {
      const rows = Array.from({ length: 700 }, (_, i) =>
        attempt(String(i), {
          kind: "skill",
          status: i < 50 ? "pending_checks" : "ready_to_finalize",
        }),
      );
      const { ctx, limits } = queryCtx(rows);
      await expect(list(ctx, { version, limit })).resolves.toEqual([]);
      expect(limits).toEqual([expected, expected - 50]);
      expect(ctx.db.get).not.toHaveBeenCalled();
    },
  );

  it("point-reads explicit IDs beyond the scan window and applies the same filter without duplicates", async () => {
    const rows = [
      attempt("one"),
      attempt("other", { version: "2026.9.2" }),
      attempt("done", { status: "finalized" }),
      attempt("foreign", { slug: "@other/plugin" }),
    ];
    const { ctx } = queryCtx(rows);
    await expect(
      list(ctx, {
        version,
        slugPrefix,
        attemptIds: [
          "publishAttempts:one",
          "publishAttempts:one",
          "publishAttempts:other",
          "publishAttempts:done",
          "publishAttempts:foreign",
          "publishAttempts:missing",
        ],
      }),
    ).resolves.toMatchObject([{ attemptId: "publishAttempts:one" }]);
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.get.mock.calls.filter(([id]) => id === "publishAttempts:one")).toHaveLength(1);
    await expect(
      list(ctx, {
        version,
        attemptIds: Array.from({ length: 201 }, (_, i) => `publishAttempts:${i}`),
      }),
    ).rejects.toThrow("At most 200 attemptIds are allowed");
  });

  it("defaults to a dry run and performs no mutations", async () => {
    const ctx = actionCtx();
    const result = await discard(ctx, { version, slugPrefix, reason: "Incident cleanup" });
    expect(result).toMatchObject({
      dryRun: true,
      candidates: [{ attemptId: "publishAttempts:one" }, { attemptId: "publishAttempts:gone" }],
      discarded: [],
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("explicit apply delegates each candidate to the owner with the attempt ID and trimmed publisher-visible reason", async () => {
    const ctx = actionCtx();
    await expect(
      discard(ctx, { version, slugPrefix, reason: "  Incident cleanup  ", dryRun: false }),
    ).resolves.toMatchObject({
      dryRun: false,
      discarded: [
        { attemptId: "publishAttempts:one", releaseDeleted: true, parentDeleted: true },
        { attemptId: "publishAttempts:gone", releaseDeleted: false, parentDeleted: true },
      ],
    });
    expect(ctx.runMutation.mock.calls.map(([ref, args]) => [getFunctionName(ref), args])).toEqual(
      ["one", "gone"].map((id) => [
        "packages:discardPendingPackagePublicationInternal",
        {
          packageId: `packages:${id}`,
          releaseId: `packageReleases:${id}`,
          attemptId: `publishAttempts:${id}`,
          createdNewParent: true,
          reason: "Incident cleanup",
        },
      ]),
    );
  });

  it("restricts an apply to explicitly selected matching IDs", async () => {
    const ctx = actionCtx();
    await discard(ctx, {
      version,
      slugPrefix,
      attemptIds: ["publishAttempts:gone"],
      reason: "Cleanup",
      dryRun: false,
    });
    expect(ctx.runMutation.mock.calls.map(([, args]) => args.attemptId)).toEqual([
      "publishAttempts:gone",
    ]);
  });

  it.each([
    ["  ", "Reason is required"],
    ["x".repeat(501), "Reason too long (max 500 chars)"],
  ])("rejects invalid reasons before any reads or writes: %s", async (reason, message) => {
    const ctx = actionCtx();
    await expect(discard(ctx, { version, reason, dryRun: false })).rejects.toThrow(message);
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("accepts a trimmed 500-character reason", async () => {
    const ctx = actionCtx([]);
    await expect(discard(ctx, { version, reason: ` ${"x".repeat(500)} ` })).resolves.toEqual({
      dryRun: true,
      candidates: [],
      discarded: [],
    });
  });

  it("requires admin authorization before delegating the public action", async () => {
    const args = { version, reason: "Cleanup" };
    const ctx = { runAction: vi.fn(async () => ({ dryRun: true, candidates: [], discarded: [] })) };
    auth.requireUserFromAction.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(discardAsAdmin(ctx, args)).rejects.toThrow("Unauthorized");
    for (const role of ["user", "moderator"]) {
      auth.requireUserFromAction.mockResolvedValueOnce({ user: { role } });
      await expect(discardAsAdmin(ctx, args)).rejects.toThrow();
    }
    expect(ctx.runAction).not.toHaveBeenCalled();
    auth.requireUserFromAction.mockResolvedValueOnce({ user: { role: "admin" } });
    await expect(discardAsAdmin(ctx, args)).resolves.toMatchObject({ dryRun: true });
    const [ref, delegated] = ctx.runAction.mock.calls[0] as unknown as [
      Parameters<typeof getFunctionName>[0],
      unknown,
    ];
    expect(getFunctionName(ref)).toBe("maintenance:discardStalePackagePublishAttemptsInternal");
    expect(delegated).toEqual(args);
  });
});
