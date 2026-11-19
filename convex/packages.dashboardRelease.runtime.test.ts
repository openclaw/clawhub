/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { createPackageSeedDefaults } from "../src/__tests__/helpers/packageSeed";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const name = "@owner/prerelease-plugin";
const version = "0.1.0-beta.3";

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { handle: "owner" });
    const packageId = await ctx.db.insert("packages", {
      ...createPackageSeedDefaults(),
      name,
      normalizedName: name,
      displayName: "Prerelease plugin",
      ownerUserId: owner,
      scanStatus: "pending",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
    });
    const release = {
      packageId,
      version,
      changelog: "Beta",
      publicationStatus: "published" as const,
      distTags: ["beta"],
      files: [],
      integritySha256: "fixture",
      sha256hash: "fixture",
      llmAnalysis: { status: "clean", checkedAt: 1 },
      createdBy: owner,
      createdAt: 1,
    };
    const beta = await ctx.db.insert("packageReleases", release);
    await ctx.db.patch(packageId, { tags: { beta } });
    return { owner, packageId, release, beta };
  });
  const owner = t.withIdentity({ subject: ids.owner });
  const list = async () => (await owner.query(api.packages.list, {}))[0];
  return { t, ...ids, list };
}

it("shows the published beta's scan and version without promoting latest", async () => {
  const { t, packageId, beta, list } = await fixture();
  const row = await list();
  expect(row).toMatchObject({
    scanStatus: "clean",
    latestVersion: version,
    latestRelease: { version },
  });
  expect(row?.pendingReview).toBeUndefined();
  const stored = await t.run((ctx) => ctx.db.get(packageId));
  expect(stored?.tags).toEqual({ beta });
  expect(stored?.latestReleaseId).toBeUndefined();
  expect(stored?.scanStatus).toBe("pending");
});

it.each(["malicious", "suspicious"] as const)(
  "does not clear a %s package warning with a clean beta",
  async (scanStatus) => {
    const { t, packageId, list } = await fixture();
    await t.run((ctx) => ctx.db.patch(packageId, { scanStatus }));
    expect((await list())?.scanStatus).toBe(scanStatus);
  },
);

it.each(["pending", "suspicious", "malicious"] as const)(
  "shows the real %s verdict on a tagged release",
  async (status) => {
    const { t, beta, list } = await fixture();
    await t.run((ctx) => ctx.db.patch(beta, { llmAnalysis: { status, checkedAt: 2 } }));
    const row = await list();
    expect(row).toMatchObject({ scanStatus: status, latestVersion: version });
    expect(Boolean(row?.pendingReview)).toBe(status === "pending");
  },
);

it("prefers the stable pointer over both a more recent beta and a stale version summary", async () => {
  const { t, beta, packageId, release, list } = await fixture();
  await t.run(async (ctx) => {
    const latest = await ctx.db.insert("packageReleases", {
      ...release,
      version: "0.1.0",
      createdAt: 0,
      distTags: ["latest"],
      llmAnalysis: { status: "suspicious", checkedAt: 1 },
    });
    await ctx.db.patch(packageId, {
      latestReleaseId: latest,
      tags: { beta, latest },
      latestVersionSummary: { version: "stale", createdAt: 1, changelog: "stale" },
    });
  });
  expect(await list()).toMatchObject({
    latestVersion: "0.1.0",
    latestRelease: { version: "0.1.0" },
    scanStatus: "suspicious",
  });
});

it("accepts aliases to one release, but does not guess when tags disagree", async () => {
  const { t, beta, packageId, release, list } = await fixture();
  await t.run((ctx) => ctx.db.patch(packageId, { tags: { beta, next: beta } }));
  expect((await list())?.latestVersion).toBe(version);
  await t.run(async (ctx) => {
    const next = await ctx.db.insert("packageReleases", { ...release, version: "2.0.0-rc.1" });
    await ctx.db.patch(packageId, { tags: { beta, next } });
  });
  expect(await list()).toMatchObject({
    latestVersion: null,
    latestRelease: null,
    scanStatus: "pending",
  });
});

it.each([
  { publicationStatus: "pending" },
  { publicationStatus: "blocked" },
  { ownerDeletedAt: 0 },
  { softDeletedAt: 0 },
] satisfies Array<Partial<Doc<"packageReleases">>>)(
  "ignores a withheld tag target: %j",
  async (patch) => {
    const { t, beta, list } = await fixture();
    await t.run((ctx) => ctx.db.patch(beta, patch));
    expect(await list()).toMatchObject({
      latestVersion: null,
      latestRelease: null,
      scanStatus: "pending",
      pendingReview: true,
    });
  },
);

it("ignores missing and foreign tag targets", async () => {
  const { t, beta, list } = await fixture();
  await t.run(async (ctx) => {
    const outsider = await ctx.db.insert("users", { handle: "outsider" });
    const foreign = await ctx.db.insert("packages", {
      ...createPackageSeedDefaults(),
      normalizedName: "foreign",
      name: "foreign",
      displayName: "Private plugin",
      channel: "private",
      ownerUserId: outsider,
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
    });
    await ctx.db.patch(beta, { packageId: foreign });
  });
  expect(await list()).toMatchObject({
    latestVersion: null,
    latestRelease: null,
    pendingReview: true,
  });
  await t.run((ctx) => ctx.db.delete(beta));
  expect(await list()).toMatchObject({
    latestVersion: null,
    latestRelease: null,
    pendingReview: true,
  });
});

it("opens the same beta inspector findings counted on the owner's dashboard", async () => {
  const { t, owner, packageId, beta, list } = await fixture();
  await t.run((ctx) =>
    ctx.db.insert("packageInspectorWarnings", {
      packageId,
      releaseId: beta,
      ownerUserId: owner,
      packageName: name,
      version,
      code: "deprecated-api",
      message: "Beta warning",
      createdAt: 1,
      authorRemediation: { summary: "Replace the deprecated API" },
    }),
  );
  expect(await list()).toMatchObject({
    inspectorWarningCount: 1,
    topInspectorFinding: { message: "Beta warning" },
  });
  const args = { name, version };
  const manager = t.withIdentity({ subject: owner });
  expect(
    await manager.query(api.packages.listPackageInspectorWarningsForManager, args),
  ).toMatchObject([{ version, message: "Beta warning" }]);
  expect(
    await manager.query(api.packages.listPackageInspectorWarningsForManager, { name }),
  ).toEqual([]);
});
