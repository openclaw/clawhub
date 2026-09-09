/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import { hashToken } from "./lib/tokens";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
it("redirects a superseded registry listing while preserving exact release history", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const seeded = await t.run(async (ctx) => {
    const staff = await ctx.db.insert("users", { handle: "staff", role: "admin" });
    const normal = await ctx.db.insert("users", { handle: "reader", role: "user" });
    const releases = [];
    const packages = [];
    for (const [handle, authorship] of [
      ["cursor", "registry"],
      ["company", "company"],
    ] as const) {
      const publisher = await ctx.db.insert("publishers", {
        kind: "org",
        handle,
        displayName: handle,
        createdAt: 1,
        updatedAt: 1,
        ...(authorship === "company"
          ? {
              staffCustody: {
                repositoryOwner: handle,
                repositoryOwnerId: 2,
                sourceRepo: "company/plugins",
                evidenceUrl: "https://company.example/plugins",
                establishedAt: 1,
                establishedBy: staff,
              },
            }
          : {}),
      });
      await ctx.db.insert("publisherMembers", {
        publisherId: publisher,
        userId: staff,
        role: "owner",
        createdAt: 1,
        updatedAt: 1,
      });
      const name = `@${handle}/notes`;
      const pkg = await ctx.db.insert("packages", {
        name,
        normalizedName: name,
        displayName: "Notes",
        ownerUserId: staff,
        ownerPublisherId: publisher,
        family: "bundle-plugin",
        channel: "community",
        isOfficial: false,
        tags: {},
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const text = `Original ${handle} bytes`;
      const bytes = new TextEncoder().encode(text);
      const hash = await hashToken(text);
      const storageId = await ctx.storage.store(new Blob([bytes]));
      const release = await ctx.db.insert("packageReleases", {
        packageId: pkg,
        version: "1.0.0",
        publicationStatus: "published",
        changelog: "Initial import",
        distTags: ["latest"],
        files: [{ path: "README.md", size: bytes.length, sha256: hash, storageId }],
        integritySha256: hash,
        createdBy: staff,
        createdAt: 1,
        source: { repo: `${handle}/plugins`, path: "", commit: "a".repeat(40) },
        curation: {
          integration: "notes",
          job: "reading",
          authorship,
          repositoryId: 1,
          ownerId: 2,
          sourceContentHash: hash,
          omittedCapabilities: [],
          format: "claude",
          syncedAt: 1,
        },
        llmAnalysis: { status: "completed", verdict: "benign", checkedAt: 1 },
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "Controlled fixture",
          engineVersion: "fixture",
          checkedAt: 1,
        },
      });
      await ctx.db.patch(pkg, { latestReleaseId: release, tags: { latest: release } });
      const row = (await ctx.db.get(pkg))!;
      await upsertPackageSearchDigest(ctx, extractPackageDigestFields(row));
      packages.push(pkg);
      releases.push(release);
    }
    return { staff, normal, packages, releases };
  });
  await t.run(async (ctx) => {
    const { _id, _creationTime, ...release } = (await ctx.db.get(seeded.releases[0]))!;
    await ctx.db.insert("packageReleases", {
      ...release,
      version: "1.1.0",
      publicationStatus: "pending",
    });
    await ctx.db.insert("packageReleases", {
      ...release,
      version: "1.2.0",
      publicationStatus: "blocked",
    });
  });
  for (const version of ["1.1.0", "1.2.0"]) {
    expect(
      (await t.fetch(`/api/v1/packages/%40cursor%2Fnotes/download?version=${version}`)).status,
    ).toBe(404);
    expect(
      (await t.fetch(`/api/v1/packages/%40cursor%2Fnotes/file?path=README.md&version=${version}`))
        .status,
    ).toBe(404);
  }
  const replace = makeFunctionReference<"mutation">(
    "curatedPlugins:setCanonicalReplacementInternal",
  );
  const args = {
    actorUserId: seeded.staff,
    name: "@cursor/notes",
    targetName: "@company/notes",
    reason: "Reviewed company source supersedes registry wrapper",
  };
  await expect(t.mutation(replace, { ...args, actorUserId: seeded.normal })).rejects.toThrow();
  const before = await (
    await t.fetch("/api/v1/packages/%40cursor%2Fnotes/file?path=README.md&version=1.0.0")
  ).text();
  await t.run((ctx) => ctx.db.patch(seeded.releases[1], { publicationStatus: "blocked" }));
  await expect(t.mutation(replace, args)).rejects.toThrow("clean published artifact");
  await t.run((ctx) => ctx.db.patch(seeded.releases[1], { publicationStatus: "published" }));
  await t.mutation(replace, args);
  const redirect = await t.fetch("/api/v1/packages/%40cursor%2Fnotes");
  expect(redirect.status).toBe(307);
  expect(redirect.headers.get("location")).toContain("%40company%2Fnotes");
  const catalog = await (await t.fetch("/api/v1/plugins?limit=100")).json();
  expect(catalog.items.map((p: { name: string }) => p.name)).toEqual(["@company/notes"]);
  expect(
    await (
      await t.fetch("/api/v1/packages/%40cursor%2Fnotes/file?path=README.md&version=1.0.0")
    ).text(),
  ).toBe(before);
  expect(await t.run((ctx) => ctx.db.get(seeded.releases[0]))).toMatchObject({
    version: "1.0.0",
    curation: { authorship: "registry" },
  });
  await t.mutation(replace, args);
});
