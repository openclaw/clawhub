// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { prepareBatch } from "./import";
import { reconcileBatch, type SyncState } from "./reconcile";
const source = {
  integration: "notes",
  job: "reading",
  repo: "company/plugins",
  path: "",
  ref: "main",
  publisher: "company",
  authorship: "company" as const,
  format: "claude" as const,
  repositoryId: 1,
  ownerId: 2,
  ownershipEvidence: "https://company.example/plugins",
  categories: ["tools" as const],
  approved: true,
  approvedInitialHash: "a".repeat(64),
};
async function batch() {
  return prepareBatch({
    manifest: { version: 1, registries: [], sources: [structuredClone(source)], openclaw: [] },
    catalog: [],
    snapshots: [
      {
        repo: source.repo,
        repositoryId: 1,
        ownerId: 2,
        commit: "a".repeat(40),
        updatedAt: "2026-09-01T00:00:00Z",
        files: {
          LICENSE: readFileSync("LICENSE", "utf8"),
          ".claude-plugin/plugin.json": JSON.stringify({ name: "notes", version: "1.0.0" }),
          "skills/read/SKILL.md": "# Read notes",
        },
      },
    ],
  });
}
function state(hash: string): NonNullable<SyncState> {
  return {
    deleted: false,
    staffCustody: true,
    latest: {
      version: "1.0.0",
      status: "published",
      scanStatus: "clean",
      source: { repo: source.repo, path: "" },
      curation: {
        integration: source.integration,
        job: source.job,
        authorship: source.authorship,
        repositoryId: 1,
        ownerId: 2,
        sourceContentHash: hash,
        omittedCapabilities: [],
        format: "claude",
      },
    },
  };
}
it("does not create another release for unchanged bytes, including reappearance", async () => {
  const prepared = await batch();
  const current = state(prepared.prepared[0].sourceContentHash);
  current.matching = current.latest;
  const result = await reconcileBatch(prepared, async () => current, true);
  expect(result.prepared).toHaveLength(0);
  expect(result.changes[0].status).toBe("unchanged");
});
it("preserves a used upstream version and allocates a new immutable version for changed bytes", async () => {
  const prepared = await batch();
  const current = state("b".repeat(64));
  current.requested = current.latest;
  const result = await reconcileBatch(prepared, async () => current, true);
  expect(result.prepared[0].version).toMatch(/^1\.0\.0\+clawhub\.[a-f0-9]{16}$/);
  expect(current.latest?.version).toBe("1.0.0");
  expect(result.prepared[0].artifactHash).toBe(prepared.prepared[0].artifactHash);
});
it("withholds a pending scan, changed repository identity, and company-adopted publisher", async () => {
  const prepared = await batch();
  for (const [current, status] of [
    [{ ...state("b".repeat(64)), staffCustody: false }, "adopted"],
    [
      {
        ...state("b".repeat(64)),
        latest: { ...state("b".repeat(64)).latest!, status: "pending" as const },
      },
      "pending",
    ],
    [
      {
        ...state("b".repeat(64)),
        latest: { ...state("b".repeat(64)).latest!, source: { repo: "other/plugins", path: "" } },
      },
      "needs-review",
    ],
  ] as const) {
    const result = await reconcileBatch(prepared, async () => current, true);
    expect(result.prepared).toHaveLength(0);
    expect(result.changes[0].status).toBe(status);
  }
});
it("requires review before a new source identity enters scheduled synchronization", async () => {
  const prepared = await batch();
  prepared.prepared[0].source.approved = false;
  expect((await reconcileBatch(prepared, async () => null, true)).prepared).toHaveLength(0);
});

it("requires the initial approved bytes for a reserved package with no releases", async () => {
  const prepared = await batch();
  const reserved = { deleted: false, staffCustody: true };
  expect((await reconcileBatch(prepared, async () => reserved, true)).changes[0].status).toBe(
    "needs-review",
  );
  prepared.prepared[0].source.approvedInitialHash = prepared.prepared[0].sourceContentHash;
  expect((await reconcileBatch(prepared, async () => reserved, true)).prepared).toHaveLength(1);
});
it("requires review when new upstream content declares a lower version", async () => {
  const prepared = await batch();
  const current = state("b".repeat(64));
  current.latest!.version = "2.0.0";
  const result = await reconcileBatch(prepared, async () => current, true);
  expect(result.prepared).toHaveLength(0);
  expect(result.changes[0].status).toBe("needs-review");
  expect((await reconcileBatch(prepared, async () => current, false)).prepared).toHaveLength(1);
});

it("preserves upstream build metadata and withholds an occupied fallback version", async () => {
  const prepared = await batch();
  prepared.prepared[0].version = "1.0.0+vendor.1";
  const current = state("b".repeat(64));
  current.latest!.version = "1.0.0+vendor.1";
  current.requested = current.latest;
  const available = await reconcileBatch(prepared, async () => current, true);
  const version = available.prepared[0].version;
  expect(version).toMatch(/^1\.0\.0\+vendor\.1\.clawhub\.[a-f0-9]{16}$/);
  const occupied = await reconcileBatch(
    prepared,
    async (_name, _hash, requested) =>
      requested === version ? { ...current, requested: { ...current.latest!, version } } : current,
    true,
  );
  expect(occupied.prepared).toHaveLength(0);
  expect(occupied.changes[0].status).toBe("needs-review");
});
