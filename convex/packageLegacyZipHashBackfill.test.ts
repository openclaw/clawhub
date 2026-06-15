/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./lib/clawpack";
import { buildDeterministicPackageZip } from "./lib/skillZip";
import {
  applyLegacyPackageZipHashBackfillInternal,
  backfillLegacyPackageZipHashesInternal,
  getLegacyPackageZipHashBackfillBatchInternal,
} from "./packageLegacyZipHashBackfill";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type BackfillResult = {
  dryRun: boolean;
  done: boolean;
  cursor: string | null;
  scanned: number;
  candidates: number;
  matched: number;
  wouldPatch: number;
  patched: number;
  skipped: number;
  errors: number;
  samples: Array<{
    releaseId: string;
    packageName: string;
    version: string;
    currentSha256hash: string | null;
    expectedSha256hash?: string;
    action: string;
  }>;
};

const backfillHandler = (
  backfillLegacyPackageZipHashesInternal as unknown as WrappedHandler<
    {
      dryRun: boolean;
      batchSize?: number;
      cursor?: string | null;
      confirmationToken?: string;
    },
    BackfillResult
  >
)._handler;

const applyHandler = (
  applyLegacyPackageZipHashBackfillInternal as unknown as WrappedHandler<
    {
      releaseId: string;
      expectedCurrentSha256hash?: string;
      sha256hash: string;
      confirmationToken: string;
    },
    { status: "patched" | "matched" | "stale" | "skipped" }
  >
)._handler;

const getBatchHandler = (
  getLegacyPackageZipHashBackfillBatchInternal as unknown as WrappedHandler<
    { batchSize?: number; cursor?: string | null },
    {
      page: Array<{
        releaseId: string;
        packageName: string;
        version: string;
        currentSha256hash: string | null;
      }>;
      scanned: number;
      continueCursor: string;
      isDone: boolean;
    }
  >
)._handler;

const packageJson = '{"name":"demo-plugin"}';
const pluginManifest = '{"id":"demo.plugin"}';

function batch(currentSha256hash = "old-tgz-hash") {
  return {
    page: [
      {
        releaseId: "packageReleases:demo",
        packageName: "demo-plugin",
        version: "1.0.0",
        currentSha256hash,
        files: [
          { path: "package.json", storageId: "storage:package" },
          { path: "openclaw.plugin.json", storageId: "storage:manifest" },
        ],
      },
    ],
    scanned: 1,
    continueCursor: "next-page",
    isDone: false,
  };
}

function storage() {
  return {
    get: vi.fn(async (storageId: string) => {
      if (storageId === "storage:package") return new Blob([packageJson]);
      if (storageId === "storage:manifest") return new Blob([pluginManifest]);
      return null;
    }),
  };
}

async function expectedLegacyZipSha256() {
  return await sha256Hex(
    buildDeterministicPackageZip([
      { path: "package.json", bytes: new TextEncoder().encode(packageJson) },
      { path: "openclaw.plugin.json", bytes: new TextEncoder().encode(pluginManifest) },
    ]),
  );
}

describe("legacy package ZIP hash backfill", () => {
  it("reads a bounded resumable page and selects only npm-pack releases", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "packageReleases:npm",
          packageId: "packages:npm",
          version: "1.0.0",
          artifactKind: "npm-pack",
          files: [],
          sha256hash: "old-tgz-hash",
        },
        {
          _id: "packageReleases:soft-deleted-npm",
          packageId: "packages:soft-deleted-npm",
          version: "2.0.0",
          artifactKind: "npm-pack",
          files: [],
          sha256hash: "old-soft-deleted-tgz-hash",
          softDeletedAt: 123,
        },
        {
          _id: "packageReleases:legacy",
          packageId: "packages:legacy",
          version: "1.0.0",
          artifactKind: "legacy-zip",
          files: [],
        },
      ],
      continueCursor: "next-page",
      isDone: false,
    });
    const order = vi.fn(() => ({ paginate }));

    const result = await getBatchHandler(
      {
        db: {
          query: vi.fn(() => ({ order })),
          get: vi.fn().mockResolvedValue({ name: "demo-plugin" }),
        },
      },
      { batchSize: 999, cursor: "current-page" },
    );

    expect(order).toHaveBeenCalledWith("asc");
    expect(paginate).toHaveBeenCalledWith({ cursor: "current-page", numItems: 10 });
    expect(result).toMatchObject({
      scanned: 3,
      continueCursor: "next-page",
      isDone: false,
      page: [
        {
          releaseId: "packageReleases:npm",
          packageName: "demo-plugin",
          currentSha256hash: "old-tgz-hash",
        },
        {
          releaseId: "packageReleases:soft-deleted-npm",
          packageName: "demo-plugin",
          currentSha256hash: "old-soft-deleted-tgz-hash",
        },
      ],
    });
  });

  it("dry-runs a resumable batch without writing", async () => {
    const runMutation = vi.fn();
    const result = await backfillHandler(
      {
        runQuery: vi.fn().mockResolvedValue(batch()),
        runMutation,
        storage: storage(),
      },
      { dryRun: true, batchSize: 1 },
    );

    expect(result).toMatchObject({
      dryRun: true,
      done: false,
      cursor: "next-page",
      scanned: 1,
      candidates: 1,
      matched: 0,
      wouldPatch: 1,
      patched: 0,
      errors: 0,
    });
    expect(result.samples).toContainEqual(
      expect.objectContaining({
        releaseId: "packageReleases:demo",
        currentSha256hash: "old-tgz-hash",
        expectedSha256hash: await expectedLegacyZipSha256(),
        action: "would-patch",
      }),
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation token before apply", async () => {
    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
      storage: storage(),
    };

    await expect(backfillHandler(ctx, { dryRun: false })).rejects.toThrow("confirmationToken");
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("applies a mismatched hash through the guarded mutation", async () => {
    const expectedSha256hash = await expectedLegacyZipSha256();
    const runMutation = vi.fn().mockResolvedValue({ status: "patched" });
    const result = await backfillHandler(
      {
        runQuery: vi.fn().mockResolvedValue(batch()),
        runMutation,
        storage: storage(),
      },
      {
        dryRun: false,
        batchSize: 1,
        confirmationToken: "BACKFILL_LEGACY_PACKAGE_ZIP_HASHES",
      },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        releaseId: "packageReleases:demo",
        expectedCurrentSha256hash: "old-tgz-hash",
        sha256hash: expectedSha256hash,
        confirmationToken: "BACKFILL_LEGACY_PACKAGE_ZIP_HASHES",
      }),
    );
    expect(result).toMatchObject({
      dryRun: false,
      wouldPatch: 0,
      patched: 1,
      errors: 0,
    });
  });

  it("does not overwrite a release that changed after the batch read", async () => {
    const patch = vi.fn();
    const result = await applyHandler(
      {
        db: {
          get: vi.fn().mockResolvedValue({
            _id: "packageReleases:demo",
            artifactKind: "npm-pack",
            sha256hash: "newer-value",
          }),
          query: vi.fn(),
          normalizeId: vi.fn(() => null),
          patch,
        },
      },
      {
        releaseId: "packageReleases:demo",
        expectedCurrentSha256hash: "old-tgz-hash",
        sha256hash: await expectedLegacyZipSha256(),
        confirmationToken: "BACKFILL_LEGACY_PACKAGE_ZIP_HASHES",
      },
    );

    expect(result).toEqual({ status: "stale" });
    expect(patch).not.toHaveBeenCalled();
  });

  it("patches soft-deleted npm-pack releases so restored downloads stay compatible", async () => {
    const patch = vi.fn();
    const sha256hash = await expectedLegacyZipSha256();
    const result = await applyHandler(
      {
        db: {
          get: vi.fn().mockResolvedValue({
            _id: "packageReleases:demo",
            artifactKind: "npm-pack",
            sha256hash: "old-tgz-hash",
            softDeletedAt: 123,
          }),
          query: vi.fn(),
          normalizeId: vi.fn(() => null),
          patch,
        },
      },
      {
        releaseId: "packageReleases:demo",
        expectedCurrentSha256hash: "old-tgz-hash",
        sha256hash,
        confirmationToken: "BACKFILL_LEGACY_PACKAGE_ZIP_HASHES",
      },
    );

    expect(result).toEqual({ status: "patched" });
    expect(patch).toHaveBeenCalledWith("packageReleases:demo", { sha256hash });
  });
});
