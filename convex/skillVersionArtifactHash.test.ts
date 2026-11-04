/* @vitest-environment node */

import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./lib/hash";
import { buildDeterministicZip } from "./lib/skillZip";
import { computeSkillVersionArtifactHashInternal } from "./skillVersionArtifactHash";

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
