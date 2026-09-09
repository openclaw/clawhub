/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { validateCuratedPluginPublisher } from "./lib/curatedPluginProvenance";
import { hashToken } from "./lib/tokens";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const configure = makeFunctionReference<"mutation">("curatedPlugins:setStaffCustodyInternal");
it("allows staff custody only for a namespace still owned entirely by staff", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ids = await t.run(async (ctx) => {
    const admin = await ctx.db.insert("users", { handle: "staff", role: "admin" });
    const company = await ctx.db.insert("users", { handle: "company-owner", role: "user" });
    const publisher = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "fixture-company",
      displayName: "Fixture",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("publisherMembers", {
      publisherId: publisher,
      userId: admin,
      role: "owner",
      createdAt: 1,
      updatedAt: 1,
    });
    return { admin, company, publisher };
  });
  const input = {
    actorUserId: ids.admin,
    publisherId: ids.publisher,
    sourceRepo: "fixture-company/plugins",
    repositoryOwnerId: 123,
    evidenceUrl: "https://example.com/official-plugins",
  };
  await expect(t.mutation(configure, { ...input, actorUserId: ids.company })).rejects.toThrow();
  await t.mutation(configure, input);
  expect(await t.run((ctx) => ctx.db.get(ids.publisher))).toMatchObject({
    staffCustody: { repositoryOwnerId: 123, sourceRepo: input.sourceRepo },
  });
  const publisher = await t.run((ctx) => ctx.db.get(ids.publisher));
  const provenance = {
    actor: { role: "admin" as const },
    publisher,
    sourceRepo: input.sourceRepo,
    curation: {
      integration: "fixture",
      job: "notes",
      authorship: "company" as const,
      repositoryId: 1,
      ownerId: 123,
      sourceContentHash: "a".repeat(64),
      omittedCapabilities: [],
      format: "cursor",
    },
  };
  expect(() => validateCuratedPluginPublisher(provenance)).not.toThrow();
  expect(() =>
    validateCuratedPluginPublisher({
      ...provenance,
      sourceRepo: "fixture-company/unreviewed-repository",
    }),
  ).toThrow("does not match staff custody");
  await t.run((ctx) =>
    ctx.db.insert("publisherMembers", {
      publisherId: ids.publisher,
      userId: ids.company,
      role: "owner",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await expect(t.mutation(configure, input)).rejects.toThrow("company members");
});

it("adopts custody only through a matching verified GitHub organization owner", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ids = await t.run(async (ctx) => {
    const admin = await ctx.db.insert("users", { handle: "staff", role: "admin" });
    const company = await ctx.db.insert("users", { handle: "company-owner", role: "user" });
    const publisher = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "fixture-company",
      displayName: "Fixture",
      createdAt: 1,
      updatedAt: 1,
      staffCustody: {
        repositoryOwner: "fixture-company",
        repositoryOwnerId: 123,
        sourceRepo: "fixture-company/plugins",
        evidenceUrl: "https://example.com/plugins",
        establishedAt: 1,
        establishedBy: admin,
      },
    });
    await ctx.db.insert("publisherMembers", {
      publisherId: publisher,
      userId: company,
      role: "owner",
      createdAt: 1,
      updatedAt: 1,
    });
    const githubMembership = await ctx.db.insert("githubOrgMemberships", {
      userId: company,
      githubOrgId: "123",
      login: "fixture-company",
      role: "member",
      syncedAt: Date.now(),
    });
    const packageFields = {
      name: "@fixture-company/notes",
      normalizedName: "@fixture-company/notes",
      displayName: "Notes",
      ownerUserId: admin,
      ownerPublisherId: publisher,
      family: "bundle-plugin" as const,
      channel: "community" as const,
      isOfficial: false,
      tags: {},
      scanStatus: "clean" as const,
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    };
    const packageId = await ctx.db.insert("packages", packageFields);
    const content = "Immutable imported notes";
    const sha256 = await hashToken(content);
    const storageId = await ctx.storage.store(new Blob([content]));
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version: "1.0.0",
      distTags: ["latest"],
      publicationStatus: "published",
      changelog: "Imported",
      files: [{ path: "README.md", size: content.length, sha256, storageId }],
      integritySha256: sha256,
      createdBy: admin,
      createdAt: 1,
      source: { repo: "fixture-company/plugins", path: "", commit: "a".repeat(40) },
      curation: {
        integration: "notes",
        job: "reading",
        authorship: "company",
        repositoryId: 1,
        ownerId: 123,
        sourceContentHash: sha256,
        omittedCapabilities: [],
        format: "claude",
        syncedAt: 1,
      },
      llmAnalysis: { status: "completed", verdict: "benign", checkedAt: 1 },
    });
    await ctx.db.patch(packageId, { latestReleaseId: releaseId, tags: { latest: releaseId } });
    const aliasId = await ctx.db.insert("packages", {
      ...packageFields,
      name: "@cursor/notes",
      normalizedName: "@cursor/notes",
      canonicalPackageId: packageId,
    });
    return { admin, company, publisher, githubMembership, packageId, releaseId, aliasId };
  });
  const company = t.withIdentity({ subject: ids.company });
  const update = makeFunctionReference<"mutation">("publishers:updateProfile");
  const args = { publisherId: ids.publisher, displayName: "Fixture Company", githubOrgId: "123" };
  await expect(company.mutation(update, args)).rejects.toThrow(
    "administers the matching GitHub organization",
  );
  await t.run((ctx) => ctx.db.patch(ids.githubMembership, { role: "admin" }));
  const history = () =>
    t.run(async (ctx) => ({
      package: await ctx.db.get(ids.packageId),
      release: await ctx.db.get(ids.releaseId),
      alias: await ctx.db.get(ids.aliasId),
    }));
  const before = await history();
  const fileUrl = "/api/v1/packages/%40fixture-company%2Fnotes/file?path=README.md&version=1.0.0";
  const bytesBefore = await (await t.fetch(fileUrl)).text();
  expect(bytesBefore).toBe("Immutable imported notes");
  await company.mutation(update, args);
  expect(await history()).toEqual(before);
  expect(await (await t.fetch(fileUrl)).text()).toBe(bytesBefore);
  const redirect = await t.fetch("/api/v1/packages/%40cursor%2Fnotes");
  expect(redirect.status).toBe(307);
  expect(redirect.headers.get("location")).toContain("%40fixture-company%2Fnotes");
  const adopted = await t.run((ctx) => ctx.db.get(ids.publisher));
  expect(adopted).toMatchObject({
    _id: ids.publisher,
    githubOrgId: "123",
    githubVerifiedByUserId: ids.company,
  });
  expect(adopted?.staffCustody).toBeUndefined();
  await expect(
    t.mutation(configure, {
      actorUserId: ids.admin,
      publisherId: ids.publisher,
      sourceRepo: "fixture-company/plugins",
      repositoryOwnerId: 123,
      evidenceUrl: "https://example.com/plugins",
    }),
  ).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.query("auditLogs").collect())).toMatchObject([
    {
      action: "publisher.profile.update",
      metadata: { adoptedStaffCustody: { repositoryOwnerId: 123 } },
    },
  ]);
});
