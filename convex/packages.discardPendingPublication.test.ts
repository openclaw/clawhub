/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { discardPendingPackagePublicationInternal } from "./packages";
import { getPackagePublishAttemptStatusInternal } from "./publishAttempts";

type Handler = {
  _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
const discard = (discardPendingPackagePublicationInternal as unknown as Handler)._handler;
const getStatus = (getPackagePublishAttemptStatusInternal as unknown as Handler)._handler;
const packageId = "packages:demo";
const releaseId = "packageReleases:pending";
const attemptId = "publishAttempts:pending";

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    _id: attemptId,
    kind: "package",
    status: "ready_to_finalize",
    packageId,
    packageReleaseId: releaseId,
    slug: "@openclaw/demo",
    version: "2026.9.1",
    userId: "users:publisher",
    createdNewParent: true,
    checkClaimId: "checks",
    checkClaimedAt: 1,
    checkClaimExpiresAt: 2,
    checkClaimLastError: "old check error",
    checkFailureCount: 2,
    finalizationClaimId: "finalize",
    finalizationClaimedAt: 3,
    finalizationClaimExpiresAt: 4,
    finalizationLastError: "old finalization error",
    checks: { trufflehog: { status: "clean" }, clawscan: { status: "clean" } },
    ...overrides,
  };
}

function makeCtx(
  options: {
    missingRelease?: boolean;
    attempts?: Record<string, unknown>[];
    publicationStatus?: string;
  } = {},
) {
  const docs = new Map<string, Record<string, unknown>>([
    [packageId, { _id: packageId, name: "@openclaw/demo", normalizedName: "demo" }],
    ...(options.missingRelease
      ? []
      : [
          [
            releaseId,
            {
              _id: releaseId,
              packageId,
              version: "2026.9.1",
              publicationStatus: options.publicationStatus ?? "pending",
              files: [{ storageId: "_storage:file" }],
              clawpackStorageId: "_storage:clawpack",
            },
          ] as [string, Record<string, unknown>],
        ]),
    ...(options.attempts ?? [attempt()]).map((row): [string, Record<string, unknown>] => [
      String(row._id),
      row,
    ]),
  ]);
  const queries: Array<{ table: string; index: string; fields: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => docs.get(id) ?? null),
      patch: vi.fn(async (id: string, patch: Record<string, unknown>) =>
        Object.assign(docs.get(id) ?? {}, patch),
      ),
      delete: vi.fn(async (id: string) => {
        docs.delete(id);
      }),
      normalizeId: vi.fn(),
      insert: vi.fn(),
      replace: vi.fn(),
      query: vi.fn((table: string) => ({
        withIndex: (
          index: string,
          build: (q: { eq: (key: string, value: unknown) => unknown }) => unknown,
        ) => {
          const fields: Record<string, unknown> = {};
          const q = {
            eq: (key: string, value: unknown) => {
              fields[key] = value;
              return q;
            },
          };
          build(q);
          queries.push({ table, index, fields });
          return {
            take: async (limit: number) =>
              [...docs.values()]
                .filter(
                  (row) =>
                    String(row._id).startsWith(`${table}:`) &&
                    Object.entries(fields).every(([key, value]) => row[key] === value),
                )
                .slice(0, limit),
          };
        },
      })),
    },
    storage: { delete: vi.fn() },
  };
  return { ctx, docs, queries };
}

describe("discardPendingPackagePublicationInternal", () => {
  it.each([
    [false, "pending_checks"],
    [false, "ready_to_finalize"],
    [false, "finalizing"],
    [true, "pending_checks"],
    [true, "ready_to_finalize"],
    [true, "finalizing"],
  ] as const)(
    "retires the owner and exposes the reason (missing release: %s, status: %s)",
    async (missingRelease, status) => {
      const { ctx, docs } = makeCtx({ missingRelease, attempts: [attempt({ status })] });
      const reason = "Discarded failed-parent release; publish a fresh approved recovery";
      await expect(
        discard(ctx, { packageId, releaseId, attemptId, reason, createdNewParent: true }),
      ).resolves.toEqual({
        deleted: !missingRelease,
        parentDeleted: true,
        retiredAttemptIds: [attemptId],
      });
      expect(docs.has(releaseId)).toBe(false);
      expect(docs.has(packageId)).toBe(false);
      expect(ctx.db.patch).toHaveBeenCalledExactlyOnceWith(attemptId, {
        status: "failed",
        failedAt: expect.any(Number),
        updatedAt: expect.any(Number),
        checkClaimId: undefined,
        checkClaimedAt: undefined,
        checkClaimExpiresAt: undefined,
        checkClaimLastError: status === "pending_checks" ? reason : undefined,
        checkFailureCount: undefined,
        finalizationClaimId: undefined,
        finalizationClaimedAt: undefined,
        finalizationClaimExpiresAt: undefined,
        finalizationLastError: status === "pending_checks" ? undefined : reason,
      });
      const statusCtx = {
        db: { ...ctx.db, normalizeId: vi.fn((_table: string, id: string) => id) },
      };
      await expect(getStatus(statusCtx, { attemptId })).resolves.toMatchObject({
        status: "failed",
        error: reason,
      });
      expect(ctx.storage.delete.mock.calls).toEqual(
        missingRelease ? [] : [["_storage:file"], ["_storage:clawpack"]],
      );
    },
  );

  it.each([false, true])(
    "finds owners by stored package name and preserves other releases, versions and terminal attempts (missing: %s)",
    async (missingRelease) => {
      const untouched = [
        attempt({
          _id: "publishAttempts:other-release",
          packageReleaseId: "packageReleases:other",
        }),
        attempt({
          _id: "publishAttempts:other-version",
          version: "2026.9.2",
          packageReleaseId: "packageReleases:new",
        }),
        attempt({ _id: "publishAttempts:finalized", status: "finalized" }),
      ];
      const snapshots = structuredClone(untouched);
      const second = attempt({ _id: "publishAttempts:second", status: "pending_checks" });
      const { ctx, docs, queries } = makeCtx({
        missingRelease,
        attempts: [attempt(), second, ...untouched],
      });
      await expect(discard(ctx, { packageId, releaseId })).resolves.toMatchObject({
        deleted: !missingRelease,
        retiredAttemptIds: [second._id, attemptId],
      });
      expect(docs.get(attemptId)).toMatchObject({
        status: "failed",
        finalizationLastError: "Pending package release discarded",
      });
      expect(docs.get(second._id)).toMatchObject({
        status: "failed",
        checkClaimLastError: "Pending package release discarded",
      });
      for (const row of snapshots) expect(docs.get(row._id)).toEqual(row);
      expect(queries).toEqual(
        ["pending_checks", "ready_to_finalize", "finalizing"].map((status) => ({
          table: "publishAttempts",
          index: "by_kind_status_slug_version_created",
          fields: {
            kind: "package",
            status,
            slug: "@openclaw/demo",
            ...(missingRelease ? {} : { version: "2026.9.1" }),
          },
        })),
      );
    },
  );

  it("retires an explicit orphan even when both release and parent are gone", async () => {
    const { ctx, docs } = makeCtx({ missingRelease: true });
    docs.delete(packageId);
    await expect(
      discard(ctx, { packageId, releaseId, attemptId, createdNewParent: true }),
    ).resolves.toEqual({
      deleted: false,
      parentDeleted: false,
      retiredAttemptIds: [attemptId],
    });
    expect(docs.get(attemptId)?.status).toBe("failed");
  });

  it.each(["finalized", "failed", "blocked", "expired"])(
    "leaves a %s attempt and its release alone after candidate discovery",
    async (status) => {
      const { ctx } = makeCtx({ attempts: [attempt({ status })] });
      await expect(discard(ctx, { packageId, releaseId, attemptId })).resolves.toEqual({
        deleted: false,
        retiredAttemptIds: [],
      });
      expect(ctx.db.delete).not.toHaveBeenCalled();
      expect(ctx.db.patch).not.toHaveBeenCalled();
    },
  );

  it("never deletes a published release or changes its attempt", async () => {
    const { ctx } = makeCtx({ publicationStatus: "published" });
    await expect(discard(ctx, { packageId, releaseId, attemptId })).resolves.toEqual({
      deleted: false,
      retiredAttemptIds: [],
    });
    expect(ctx.db.delete).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "skill" },
    { packageReleaseId: "packageReleases:other" },
    { packageId: "packages:other" },
  ])("rejects an attempt that does not own the release: %s", async (overrides) => {
    const { ctx } = makeCtx({ attempts: [attempt(overrides)] });
    await expect(discard(ctx, { packageId, releaseId, attemptId })).rejects.toThrow(
      "Publish attempt does not own the pending package release",
    );
    expect(ctx.db.delete).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
