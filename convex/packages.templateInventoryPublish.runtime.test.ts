/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { npmPackFixture } from "../packages/clawhub/test/npmPack";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { parseClawPack, sha256Hex } from "./lib/clawpack";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const name = "@maker/source-test";
const version = "1.0.0";
const manifest = (label: string) =>
  `---\nschemaVersion: 1\nagent: { id: source-test, name: ${label} }\ncategories: [productivity]\n---\nInternal guide text.\n`;

async function fixture(archiveName = name, largeBundle = false) {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const envelope = (packageName: string) =>
    JSON.stringify({ name: packageName, version, openclaw: { template: "CLAW.md" } });
  const bundle = largeBundle ? "x".repeat(8 * 1024 * 1024) : undefined;
  const archive = npmPackFixture({
    "package/package.json": envelope(archiveName),
    "package/CLAW.md": manifest("Exact archive"),
    ...(bundle ? { "package/workspace/bundle.txt": bundle } : {}),
  });
  const parsed = await parseClawPack(archive);
  const archiveBlob = new Blob([Uint8Array.from(archive)]);
  const staged = await t.run(async (ctx) => {
    const actorUserId = await ctx.db.insert("users", { handle: "maker", role: "admin" });
    const storageId = await ctx.storage.store(archiveBlob);
    // Both markers are valid. Only the .tgz, not these individually staged files, binds display.
    const files = [];
    for (const [path, body] of Object.entries({
      "package.json": envelope(name),
      "CLAW.md": manifest(largeBundle ? "Exact archive" : "Staged marker"),
      ...(bundle ? { "workspace/bundle.txt": bundle } : {}),
    })) {
      const bytes = new TextEncoder().encode(body);
      files.push({
        path,
        size: bytes.length,
        sha256: await sha256Hex(bytes),
        storageId: await ctx.storage.store(new Blob([body])),
      });
    }
    return { actorUserId, storageId, files };
  });
  const artifact = {
    kind: "npm-pack",
    storageId: staged.storageId,
    sha256: parsed.artifactSha256,
    size: archive.length,
    format: "tgz",
    npmIntegrity: parsed.npmIntegrity,
    npmShasum: parsed.npmShasum,
    npmTarballName: parsed.npmTarballName,
    npmUnpackedSize: parsed.unpackedSize,
    npmFileCount: parsed.fileCount,
  };
  const publish = (overrides: Partial<typeof artifact> = {}) =>
    t.action(internal.packages.publishPackageForUserInternal, {
      actorUserId: staged.actorUserId,
      payload: {
        name,
        family: "template",
        version,
        changelog: "First version",
        expectedArtifactSha256: artifact.sha256,
        files: staged.files,
        artifact: { ...artifact, ...overrides },
      },
    });
  const snapshot = (releaseId: Id<"packageReleases">) =>
    t.run((ctx) =>
      ctx.db
        .query("templateDisplaySnapshots")
        .withIndex("by_release", (q) => q.eq("releaseId", releaseId))
        .unique(),
    );
  return { t, publish, snapshot, artifact, archiveBlob, actorUserId: staged.actorUserId };
}

afterEach(() => {
  vi.useRealTimers();
});

it("binds the stored archive's display data to the pending release without exposing it or rebinding on retry", async () => {
  const { t, publish, snapshot, artifact, archiveBlob } = await fixture();
  const result = await publish();
  expect(result).toMatchObject({ publicationStatus: "pending", artifactSha256: artifact.sha256 });
  const saved = await snapshot(result.releaseId);
  expect(saved).toMatchObject({
    releaseId: result.releaseId,
    packageId: result.packageId,
    binding: {
      packageName: name,
      version,
      storageId: artifact.storageId,
      sha256: artifact.sha256,
      npmIntegrity: artifact.npmIntegrity,
      npmShasum: artifact.npmShasum,
      size: archiveBlob.size,
    },
    data: {
      manifestPath: "CLAW.md",
      templateManifestSummary: { agent: { name: "Exact archive" } },
      contents: { instructions: [{ name: "SOUL.md", source: "CLAW.md#body" }] },
    },
  });
  expect(JSON.stringify(saved)).not.toContain("Internal guide text");
  expect(
    await t.query(internal.packages.getPublicTemplateInventoryInternal, { name, version }),
  ).toBeNull();
  const secondStorageId = await t.run((ctx) => ctx.storage.store(archiveBlob));
  expect(await publish({ storageId: secondStorageId })).toEqual(result);
  expect(await snapshot(result.releaseId)).toEqual(saved);
});

it("captures the first pending Template even when its reserved name still has a plugin family", async () => {
  const { t, publish, snapshot, actorUserId } = await fixture();
  await t.mutation(internal.packages.reservePackageNameInternal, {
    name,
    actorUserId,
    ownerUserId: actorUserId,
  });
  const result = await publish();
  expect(result.publicationStatus).toBe("pending");
  expect(await t.run((ctx) => ctx.db.get(result.packageId))).toMatchObject({
    family: "code-plugin",
    channel: "private",
  });
  expect(await snapshot(result.releaseId)).toMatchObject({
    data: { templateManifestSummary: { agent: { name: "Exact archive" } } },
  });
  expect(
    await t.query(internal.packages.getPublicTemplateInventoryInternal, { name, version }),
  ).toBeNull();
});

it("accepts a Template beyond inventory capacity without giving the pending release public access", async () => {
  const { t, publish, snapshot } = await fixture(name, true);
  const result = await publish();
  expect(result.publicationStatus).toBe("pending");
  expect(await snapshot(result.releaseId)).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(result.releaseId))).toMatchObject({
    extractedPackageJson: { name, version, openclaw: { template: "CLAW.md" } },
    clawManifestSummary: { schemaVersion: 1 },
  });
  expect(await t.query(internal.packages.getPublicTemplateInventoryInternal, { name })).toBeNull();
});

it("keeps publication compatible but writes no display snapshot for a different archive envelope", async () => {
  const { publish, snapshot } = await fixture("@maker/another-template");
  const result = await publish();
  expect(result.publicationStatus).toBe("pending");
  expect(await snapshot(result.releaseId)).toBeNull();
});
