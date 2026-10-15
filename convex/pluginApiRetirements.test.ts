/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

it("projects latest-release retirements publicly while preserving privacy, errors and manager nudges", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  const retirement = {
    deprecatedApi: "readAcpSessionEntry",
    replacement: "readAcpSessionEntryAsync",
    removeAfter: "2026-12-31",
  };
  const fixture = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { role: "user" });
    const stranger = await ctx.db.insert("users", { role: "user" });
    const packageId = await ctx.db.insert("packages", {
      name: "retirement-fixture",
      normalizedName: "retirement-fixture",
      displayName: "Retirement Fixture",
      ownerUserId: owner,
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      tags: {},
      scanStatus: "clean",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version: "1.0.0",
      changelog: "Fixture",
      distTags: ["latest"],
      files: [],
      integritySha256: "fixture",
      createdBy: owner,
      createdAt: 1,
    });
    await ctx.db.patch(packageId, { latestReleaseId: releaseId });
    const base = {
      packageId,
      releaseId,
      ownerUserId: owner,
      packageName: "retirement-fixture",
      version: "1.0.0",
      createdAt: 1,
    };
    await ctx.db.insert("packageInspectorWarnings", {
      ...base,
      code: "missing-api",
      findingKind: "error",
      deprecated: true,
      ...retirement,
      deprecatedApi: "incompatibleApi",
      targetOpenClawVersion: "2026.10.1",
      message: "Existing incompatibility",
      authorRemediation: { summary: "Fix the incompatible API" },
    });
    return { owner, stranger, packageId, releaseId };
  });
  await t.mutation(internal.packages.insertPackageInspectorWarningsInternal, {
    packageId: fixture.packageId,
    releaseId: fixture.releaseId,
    ownerUserId: fixture.owner,
    packageName: "retirement-fixture",
    version: "1.0.0",
    findings: [
      {
        code: "sdk-deprecated-api",
        level: "warning",
        deprecated: true,
        ...retirement,
        message: "Private detailed finding",
        evidence: ["private/source.ts:12"],
      },
    ],
  });
  const args = { name: "retirement-fixture" };
  expect(await t.query(api.packages.getPackageInspectorValidationSummaryPublic, args)).toEqual({
    findingCount: 2,
    warningCount: 1,
    errorCount: 1,
    incompatibleAfterOpenClawVersion: "2026.10.1",
    apiRetirements: [retirement],
  });
  expect(await t.query(api.packages.listPackageInspectorFindingsPublic, args)).toEqual([]);
  expect(
    await t
      .withIdentity({ subject: fixture.stranger })
      .query(api.packages.listPackageInspectorFindingsPublic, args),
  ).toEqual([]);
  const manager = t.withIdentity({ subject: fixture.owner });
  expect(await manager.query(api.packages.listPackageInspectorFindingsPublic, args)).toHaveLength(
    2,
  );
  expect(await manager.query(api.packages.list, {})).toEqual([
    expect.objectContaining({
      apiRetirements: [retirement],
      inspectorWarningCount: 1,
      topInspectorFinding: {
        message: "Existing incompatibility",
        remediation: "Fix the incompatible API",
      },
    }),
  ]);
  await t.run((ctx) => ctx.db.patch(fixture.packageId, { channel: "private" }));
  expect(
    (await t.query(api.packages.getPackageInspectorValidationSummaryPublic, args)).apiRetirements,
  ).toEqual([]);
  expect(
    (
      await t
        .withIdentity({ subject: fixture.stranger })
        .query(api.packages.getPackageInspectorValidationSummaryPublic, args)
    ).apiRetirements,
  ).toEqual([]);
  expect(
    (await manager.query(api.packages.getPackageInspectorValidationSummaryPublic, args))
      .apiRetirements,
  ).toEqual([retirement]);
  await t.run(async (ctx) => {
    const nextRelease = await ctx.db.get(fixture.releaseId);
    if (!nextRelease) throw new Error("Missing fixture release");
    const { _id, _creationTime, ...fields } = nextRelease;
    const nextId = await ctx.db.insert("packageReleases", { ...fields, version: "2.0.0" });
    await ctx.db.patch(fixture.packageId, { channel: "community", latestReleaseId: nextId });
  });
  expect(
    (await t.query(api.packages.getPackageInspectorValidationSummaryPublic, args)).apiRetirements,
  ).toEqual([]);
});
