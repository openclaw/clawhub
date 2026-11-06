/* @vitest-environment node */

import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./lib/hash";
import { buildDeterministicZip } from "./lib/skillZip";
import {
  backfillMissingSkillVersionArtifactHashesInternal,
  computeSkillVersionArtifactHashInternal,
} from "./skillVersionArtifactHash";

type Handler = (ctx: unknown, args: { versionId: string }) => Promise<unknown>;
const handler = (computeSkillVersionArtifactHashInternal as unknown as { _handler: Handler })
  ._handler;

const encoder = new TextEncoder();

function makeCtx(options: {
  fingerprints?: Array<{ fingerprint: string; kind?: "source" | "generated-bundle" }>;
  version?: Record<string, unknown> | null;
}) {
  const storage = new Map<string, string>([
    ["storage:skill", "# Demo\n"],
    ["storage:script", "echo demo\n"],
    ["storage:card", "generated card\n"],
  ]);
  const version =
    options.version === undefined
      ? {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.2.3",
          createdAt: 1_700_000_000_000,
          files: [
            { path: "SKILL.md", storageId: "storage:skill" },
            { path: "scripts/run.sh", storageId: "storage:script" },
            { path: "skill-card.md", storageId: "storage:card" },
          ],
        }
      : options.version;
  const runQuery = vi.fn(async (ref: unknown) => {
    const name = getFunctionName(ref as never);
    if (name === "skills:getVersionByIdInternal") return version;
    if (name === "skills:getSkillByIdInternal") {
      return { _id: "skills:1", slug: "demo", ownerUserId: "users:owner" };
    }
    if (name === "skills:listVersionFingerprintsInternal") return options.fingerprints ?? [];
    throw new Error(`Unexpected query ${name}`);
  });
  const runMutation = vi.fn(async () => undefined);
  const ctx = {
    runQuery,
    runMutation,
    storage: {
      get: vi.fn(async (id: string) => {
        const text = storage.get(id);
        return text === undefined ? null : new Blob([text]);
      }),
    },
  };
  return { ctx, runMutation };
}

describe("computeSkillVersionArtifactHashInternal", () => {
  it("stores the deterministic ZIP hash previously computed by the VirusTotal upload", async () => {
    const { ctx, runMutation } = makeCtx({
      fingerprints: [{ fingerprint: "bundle", kind: "generated-bundle" }],
    });

    const result = await handler(ctx, { versionId: "skillVersions:1" });

    // Generated Skill Cards are excluded so the hash matches the published source ZIP.
    const expected = await sha256Hex(
      buildDeterministicZip(
        [
          { path: "SKILL.md", bytes: encoder.encode("# Demo\n") },
          { path: "scripts/run.sh", bytes: encoder.encode("echo demo\n") },
        ],
        {
          ownerId: "users:owner",
          slug: "demo",
          version: "1.2.3",
          publishedAt: 1_700_000_000_000,
        },
      ),
    );
    // Golden value produced by the same inputs on origin/main (the retired VirusTotal
    // upload path); pins byte parity with historical hashes.
    expect(expected).toBe("86723f5255a8a99851dfb9814be72086eec0c28411df24911789f4e2ab795f38");
    expect(result).toEqual({ ok: true, sha256hash: expected });
    expect(runMutation).toHaveBeenCalledTimes(1);
    const [ref, args] = runMutation.mock.calls[0] as unknown as [unknown, unknown];
    expect(getFunctionName(ref as never)).toBe("skills:updateVersionSha256HashInternal");
    expect(args).toEqual({ versionId: "skillVersions:1", sha256hash: expected });
  });

  it("skips missing versions without writing", async () => {
    const { ctx, runMutation } = makeCtx({ version: null });

    await expect(handler(ctx, { versionId: "skillVersions:missing" })).resolves.toEqual({
      ok: false,
      reason: "missing_version",
    });
    expect(runMutation).not.toHaveBeenCalled();
  });
});

type BackfillHandler = (
  ctx: unknown,
  args: { cursor?: string | null; batchSize?: number; dryRun?: boolean },
) => Promise<unknown>;
const backfillHandler = (
  backfillMissingSkillVersionArtifactHashesInternal as unknown as { _handler: BackfillHandler }
)._handler;

function makeBackfillCtx(page: Array<Record<string, unknown>>, isDone: boolean) {
  const runAfter = vi.fn(async () => undefined);
  const paginate = vi.fn(async () => ({ page, isDone, continueCursor: "cursor:next" }));
  const ctx = {
    db: {
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({ order: vi.fn(() => ({ paginate })) })),
      })),
      get: vi.fn(),
      insert: vi.fn(),
      patch: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      normalizeId: vi.fn(() => null),
      system: {},
    },
    scheduler: { runAfter },
  };
  return { ctx, runAfter };
}

const backfillPage = [
  { _id: "skillVersions:missing", files: [{ path: "SKILL.md" }] },
  { _id: "skillVersions:hashed", sha256hash: "a".repeat(64), files: [{ path: "SKILL.md" }] },
  { _id: "skillVersions:staged", publicationStatus: "pending", files: [{ path: "SKILL.md" }] },
  { _id: "skillVersions:empty", files: [] },
];

describe("backfillMissingSkillVersionArtifactHashesInternal", () => {
  it("schedules hashes only for published versions missing one and continues paging", async () => {
    const { ctx, runAfter } = makeBackfillCtx(backfillPage, false);

    const result = await backfillHandler(ctx, { batchSize: 4 });

    expect(result).toMatchObject({ dryRun: false, matched: 1, scheduled: 1, isDone: false });
    const calls = runAfter.mock.calls as unknown as Array<[number, unknown, unknown]>;
    expect(calls.map(([delay, ref, args]) => [delay, getFunctionName(ref as never), args])).toEqual(
      [
        [
          0,
          "skillVersionArtifactHash:computeSkillVersionArtifactHashInternal",
          { versionId: "skillVersions:missing" },
        ],
        [
          1_000,
          "skillVersionArtifactHash:backfillMissingSkillVersionArtifactHashesInternal",
          { cursor: "cursor:next", batchSize: 4, scheduled: 1 },
        ],
      ],
    );
  });

  it("reports one page without scheduling in dry-run mode", async () => {
    const { ctx, runAfter } = makeBackfillCtx(backfillPage, false);

    const result = await backfillHandler(ctx, { dryRun: true });

    expect(result).toMatchObject({ dryRun: true, matched: 1, scheduled: 0, isDone: false });
    expect(runAfter).not.toHaveBeenCalled();
  });
});
