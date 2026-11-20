/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { gunzipSync, gzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { npmPackFixture } from "../packages/clawhub/test/npmPack";
import { createPackageSeedDefaults } from "../src/__tests__/helpers/packageSeed";
import { internal } from "./_generated/api";
import { parseClawPack, sha256Hex } from "./lib/clawpack";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");
const name = "display-template";
const base = "/api/v1/packages/@display-owner/display-template";
const view = base + "?view=template-inventory";
const manifestPath = "nested/CLAW.md";
const marker = "body-not-on-the-wire";
async function fixture(
  options: {
    declaredName?: string;
    schemaVersion?: number;
    capacity?: "tar" | "archive";
    legacy?: "field" | "sidecar" | "missing-workspace" | "invalid-list";
  } = {},
) {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { handle: "display-owner", role: "user" });
    await ctx.db.insert("apiTokens", {
      userId: owner,
      label: "reader",
      prefix: "reader",
      tokenHash: await hashToken("display-owner-token"),
      createdAt: 1,
    });
    const pkg = await ctx.db.insert("packages", {
      ...createPackageSeedDefaults(),
      family: "claw",
      name,
      normalizedName: name,
      displayName: "Display",
      ownerUserId: owner,
      scanStatus: "clean",
      stats: { versions: 2, downloads: 0, stars: 0, installs: 0 },
    });
    const add = async (version: string) => {
      const capacity = version === "2.0.0" ? options.capacity : undefined;
      const packed = npmPackFixture({
        ...(capacity
          ? {
              "package/workspace/large.txt": new Uint8Array(
                (capacity === "tar" ? 8 : 4) * 1024 * 1024,
              ),
            }
          : {}),
        ...(options.legacy === "sidecar" ? { "package/profiles/old.yml": "historical" } : {}),
        "package/package.json": JSON.stringify({
          name: options.declaredName ?? name,
          version,
          openclaw: { template: manifestPath },
        }),
        ["package/" + manifestPath]: [
          "---",
          JSON.stringify({
            schemaVersion: options.schemaVersion ?? 1,
            ...(options.legacy && options.legacy !== "sidecar"
              ? { packages: options.legacy === "invalid-list" ? "not a dependency list" : [] }
              : {}),
            agent: { id: "display", name: "Display " + version },
            workspace: {
              bootstrapFiles: { "AGENTS.md": { source: "workspace/system.md" } },
              files: [
                {
                  path: "skills/notes/SKILL.md",
                  source:
                    options.legacy === "missing-workspace"
                      ? "workspace/not-published.md"
                      : "workspace/file.md",
                },
              ],
            },
            skills: [{ path: "skills/real" }],
            plugins: [{ ref: "@display-owner/notes", version: "1.0.0" }],
            mcpServers: {
              calendar: { transport: "streamable-http", url: "https://example.org/mcp" },
            },
            automations: [
              {
                id: "daily",
                name: "Digest",
                enabled: false,
                schedule: { cron: "0 9 * * *", timezone: "UTC" },
                message: marker,
                session: "isolated",
              },
            ],
          }),
          "---",
          marker,
        ].join("\n"),
        "package/BOOTSTRAP.md": marker,
        "package/workspace/file.md": marker,
        "package/workspace/system.md": marker,
        "package/skills/real/SKILL.md":
          "---\nname: Verified skill\ndescription: Real example\n---\n" + marker,
      });
      // Stored (uncompressed) gzip blocks cross the compressed-size cap deterministically.
      const pack = capacity === "archive" ? gzipSync(gunzipSync(packed), { level: 0 }) : packed;
      const artifact = await parseClawPack(pack);
      const files = await Promise.all(
        (capacity || options.legacy ? artifact.entries : []).map(async ({ path, bytes }) => ({
          path,
          size: bytes.byteLength,
          sha256: await sha256Hex(bytes),
          storageId: await ctx.storage.store(new Blob([Uint8Array.from(bytes)])),
        })),
      );
      const file = await ctx.storage.store(new Blob([Uint8Array.from(pack)]));
      const release = await ctx.db.insert("packageReleases", {
        packageId: pkg,
        version,
        files,
        ...(capacity || options.legacy
          ? {
              extractedPackageJson: artifact.packageJson,
              clawManifestSummary: {
                schemaVersion: 1 as const,
                agent: { id: "display", name: "Display " + version },
                workspace: { bootstrapFiles: ["AGENTS.md"], fileCount: 1 },
                packages: { skillCount: 1, pluginCount: 1 },
                ...(options.legacy
                  ? {
                      profiles: { count: options.legacy === "sidecar" ? 1 : 0, hasOpenClaw: false },
                    }
                  : {}),
                mcpServerCount: 1,
                cronJobCount: 1,
              },
            }
          : {}),
        changelog: marker,
        distTags: [],
        createdBy: owner,
        createdAt: 1,
        publicationStatus: "published",
        integritySha256: "a".repeat(64),
        artifactKind: "npm-pack",
        clawpackStorageId: file,
        clawpackSha256: artifact.artifactSha256,
        clawpackSize: pack.length,
        npmIntegrity: artifact.npmIntegrity,
        npmShasum: artifact.npmShasum,
        llmAnalysis: { status: "completed", verdict: "benign", summary: "Reviewed", checkedAt: 1 },
      });
      return { release, sha256: artifact.artifactSha256, file };
    };
    const prior = await add("1.0.0"),
      latest = await add("2.0.0");
    await ctx.db.patch(pkg, { latestReleaseId: latest.release, tags: { latest: latest.release } });
    return { pkg, prior, latest, owner };
  });
  return { t, ...ids };
}

describe("public Template inventory HTTP view", () => {
  it.each(["tar", "archive"] as const)(
    "offers ordinary latest metadata only for opted-in inventory capacity failures (%s)",
    async (capacity) => {
      const { t, latest, pkg } = await fixture({ capacity });
      const compat = view + "&inventoryFallback=metadata";
      const ordinary = await (await t.fetch(base)).json();
      expect((await t.fetch(view)).status).toBe(413);
      expect((await t.fetch(compat + "&version=2.0.0")).status).toBe(413);
      const res = await t.fetch(compat);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(ordinary);
      const preview = await t.fetch(base + "/file?path=nested%2FCLAW.md&preview=1&version=2.0.0");
      expect(preview.status).toBe(200);
      expect(await preview.text()).toContain("Display 2.0.0");
      // With no verifiable publication envelope this is a strict inventory error, even on latest.
      await t.run((ctx) =>
        ctx.db.patch(latest.release, {
          extractedPackageJson: { name, version: "other", openclaw: { template: manifestPath } },
        }),
      );
      expect((await t.fetch(compat)).status).toBe(413);
      await t.run((ctx) =>
        ctx.db.patch(latest.release, {
          extractedPackageJson: { name, version: "2.0.0", openclaw: { template: manifestPath } },
        }),
      );
      // A storage digest or size mismatch is not a capacity fallback.
      await t.run((ctx) => ctx.db.patch(latest.release, { clawpackSha256: "f".repeat(64) }));
      expect((await t.fetch(compat)).status).toBe(422);
      await t.run((ctx) =>
        ctx.db.patch(latest.release, {
          clawpackSha256: latest.sha256,
          clawpackSize: 5 * 1024 * 1024,
        }),
      );
      expect((await t.fetch(compat)).status).toBe(422);
      await t.run((ctx) => ctx.db.patch(pkg, { channel: "private" }));
      expect((await t.fetch(compat)).status).toBe(404);
    },
  );
  it("serves identical display metadata without touching the blob after a pinned backfill, but rechecks access and binding", async () => {
    const { t, pkg, latest, owner } = await fixture();
    const before = await (await t.fetch(view)).json();
    const backfill = (sha256: string) =>
      t.action(internal.templateDisplayBackfill.one, { name, version: "2.0.0", sha256 });
    expect(await t.run((ctx) => ctx.db.query("templateDisplaySnapshots").first())).toBeNull();
    expect(await backfill("b".repeat(64))).toBe("binding-changed");
    expect(await backfill(latest.sha256)).toBe("stored");
    expect(await backfill(latest.sha256)).toBe("already-present");
    const saved = await t.run((ctx) =>
      ctx.db
        .query("templateDisplaySnapshots")
        .withIndex("by_release", (q) => q.eq("releaseId", latest.release))
        .unique(),
    );
    expect(saved?.data).toMatchObject({
      manifestPath,
      contents: before.templateInventory.contents,
    });
    expect(JSON.stringify(saved?.data)).not.toContain(marker);
    if (!saved) throw Error("Missing verified display row");
    // Valid bytes remain available: an inconsistent row must not trigger legacy fallback or repair.
    await t.run((ctx) =>
      ctx.db.patch(saved._id, { binding: { ...saved.binding, version: "stale" } }),
    );
    expect((await t.fetch(view)).status).toBe(422);
    expect(await backfill(latest.sha256)).toBe("binding-changed");
    await t.run((ctx) => ctx.db.patch(saved._id, { binding: saved.binding }));
    // Independent storage denial: metadata still works; the normal artifact path is not authorized by it.
    await t.run((ctx) => ctx.storage.delete(latest.file));
    expect(await (await t.fetch(view)).json()).toEqual(before);
    await t.run((ctx) =>
      ctx.db.patch(latest.release, {
        manualModeration: {
          state: "quarantined",
          reviewerUserId: owner,
          reason: "changed",
          updatedAt: 3,
        },
      }),
    );
    expect((await t.fetch(view)).ok).toBe(false);
    await t.run((ctx) =>
      ctx.db.patch(latest.release, { manualModeration: undefined, npmIntegrity: "sha512-other" }),
    );
    expect((await t.fetch(view)).status).toBe(422);
    await t.run((ctx) => ctx.db.patch(pkg, { channel: "private" }));
    expect((await t.fetch(view)).status).toBe(404);
  });
  it("returns complete verified names, never bodies, for latest and historical coordinates", async () => {
    const { t, prior, latest } = await fixture();
    const ordinary = await (await t.fetch(base)).json();
    expect(ordinary).not.toHaveProperty("templateInventory");
    for (const [version, selection, suffix] of [
      ["2.0.0", latest, ""],
      ["1.0.0", prior, "&version=1.0.0"],
    ] as const) {
      const archive = base + "/versions/" + version + "/artifact/download";
      const hash = async () =>
        sha256Hex(new Uint8Array(await (await t.fetch(archive)).arrayBuffer()));
      expect(await hash()).toBe(selection.sha256);
      const security = await (
        await t.fetch("/api/v1/packages/" + name + "/versions/" + version + "/security")
      ).json();
      const res = await t.fetch(view + suffix);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.package).toEqual(ordinary.package);
      expect(body.owner).toEqual(ordinary.owner);
      expect(body.templateInventory).toMatchObject({
        schemaVersion: 1,
        packageName: name,
        version,
        manifestPath,
        artifact: {
          kind: "npm-pack",
          sha256: selection.sha256,
          npmIntegrity: security.release.npmIntegrity,
          npmShasum: security.release.npmShasum,
        },
        templateManifestSummary: { agent: { name: "Display " + version } },
        security: {
          trust: security.trust,
          securityAuditUrl: security.securityAuditUrl,
          overview: security.overview,
          release: { version, artifactSha256: selection.sha256 },
        },
        contents: {
          instructions: [
            { name: "AGENTS.md", source: "workspace/system.md" },
            { name: "skills/notes/SKILL.md", source: "workspace/file.md" },
            { name: "BOOTSTRAP.md", source: "BOOTSTRAP.md" },
            { name: "SOUL.md", source: "CLAW.md#body" },
          ],
          skills: [{ name: "Verified skill", source: "bundled", path: "skills/real" }],
          integrations: [
            {
              kind: "plugin",
              name: "@display-owner/notes",
              source: "clawhub",
              ref: "@display-owner/notes",
              version: "1.0.0",
            },
            { kind: "mcpServer", name: "calendar" },
          ],
          automations: [{ name: "Digest", enabled: false, schedule: "0 9 * * *", timezone: "UTC" }],
        },
      });
      for (const secret of [
        marker,
        "https://example.org/mcp",
        selection.file,
        'message":',
        'excerpt":',
      ])
        expect(JSON.stringify(body)).not.toContain(secret);
      expect(await hash()).toBe(selection.sha256);
    }
  });

  it("retains public-only authority after a successful read, including authenticated/cookie routes", async () => {
    const { t, pkg, latest, prior, owner } = await fixture();
    expect((await t.fetch(view)).status).toBe(200);
    await t.run((ctx) =>
      ctx.db.patch(prior.release, {
        manualModeration: {
          state: "quarantined",
          reviewerUserId: owner,
          reason: marker,
          updatedAt: 2,
        },
      }),
    );
    expect((await t.fetch(view + "&version=1.0.0")).status).toBe(403);
    await t.run((ctx) =>
      ctx.db.patch(latest.release, {
        llmAnalysis: { status: "completed", verdict: "malicious", summary: marker, checkedAt: 2 },
      }),
    );
    expect((await t.fetch(view)).status).toBe(404);
    await t.run(async (ctx) => {
      await ctx.db.patch(pkg, { channel: "private" });
      await ctx.db.patch(latest.release, { llmAnalysis: undefined });
    });
    const headers = { Authorization: "Bearer display-owner-token" };
    expect((await t.fetch(base, { headers })).status).toBe(200);
    for (const credentials of [{}, headers, { Cookie: "test=1" }]) {
      const res = await t.fetch(view, { headers: credentials as HeadersInit });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Template not found");
    }
  });

  it("never substitutes latest for missing, withdrawn or wrong-owner pinned releases", async () => {
    const { t, prior } = await fixture();
    await t.run((ctx) => ctx.db.patch(prior.release, { ownerDeletedAt: 1 }));
    for (const url of [
      view + "&version=1.0.0",
      view + "&version=stable",
      view + "&version=3.0.0",
      view.replace("display-owner", "wrong-owner"),
    ])
      expect((await t.fetch(url)).status).toBe(404);
    for (const suffix of ["&version=", "&version=2.0.0&version=1.0.0"])
      expect((await t.fetch(view + suffix)).status).toBe(400);
  });

  it.each(["field", "sidecar"] as const)(
    "displays verified retired %s only on the public latest website surface",
    async (legacy) => {
      const { t, latest } = await fixture({ legacy });
      const website = view + "&inventoryFallback=website";
      for (const strict of [
        view,
        view + "&inventoryFallback=metadata",
        website + "&version=1.0.0",
        website + "&version=2.0.0",
      ]) {
        expect((await t.fetch(strict)).status).toBe(422);
      }
      const response = await t.fetch(website);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ...(await (await t.fetch(base)).json()),
        templateDisplayOnly: true,
      });
      const preview = await t.fetch(base + "/file?path=nested%2FCLAW.md&preview=1&version=2.0.0");
      expect(preview.status).toBe(200);
      expect(await preview.text()).toContain(marker);
      const originalFiles = await t.run(async (ctx) => (await ctx.db.get(latest.release))!.files);
      await t.run((ctx) =>
        ctx.db.patch(latest.release, {
          files: originalFiles.map((file) =>
            file.path === manifestPath ? { ...file, sha256: "c".repeat(64) } : file,
          ),
        }),
      );
      expect((await t.fetch(website)).status).toBe(422);
      await t.run((ctx) => ctx.db.patch(latest.release, { files: originalFiles }));
      const savedSummary = await t.run(
        async (ctx) => (await ctx.db.get(latest.release))!.clawManifestSummary!,
      );
      await t.run((ctx) => ctx.db.patch(latest.release, { clawManifestSummary: undefined }));
      expect((await t.fetch(website)).status).toBe(422);
      await t.run((ctx) =>
        ctx.db.patch(latest.release, {
          clawManifestSummary: savedSummary,
          clawpackSha256: "b".repeat(64),
        }),
      );
      expect((await t.fetch(website)).status).toBe(422);
      await t.run((ctx) => ctx.db.patch(latest.release, { ownerDeletedAt: 1 }));
      expect((await t.fetch(website)).status).toBe(404);
    },
  );

  it.each(["missing-workspace", "invalid-list"] as const)(
    "does not treat a retired key as permission to display other invalid contents (%s)",
    async (legacy) => {
      const { t } = await fixture({ legacy });
      expect((await t.fetch(view + "&inventoryFallback=website")).status).toBe(422);
    },
  );

  it.each([{ declaredName: "different-name" }, { schemaVersion: 2 }])(
    "refuses unsupported data or wrong archive identity without leaking parser diagnostics (%j)",
    async (opts) => {
      const { t } = await fixture(opts);
      for (const mode of ["metadata", "website"]) {
        const res = await t.fetch(view + "&inventoryFallback=" + mode);
        expect(res.status).toBe(422);
        expect(await res.text()).toBe("Template inventory could not be verified");
      }
    },
  );

  it("rejects changed release hashes, mismatched release versions and oversized records after a verified read", async () => {
    const { t, latest, prior } = await fixture();
    expect((await t.fetch(view)).status).toBe(200);
    for (const patch of [
      { clawpackSha256: "b".repeat(64) },
      { clawpackSha256: latest.sha256, npmIntegrity: "sha512-other" },
      { clawpackSize: 8 * 1024 * 1024 },
    ]) {
      await t.run((ctx) => ctx.db.patch(latest.release, patch));
      expect((await t.fetch(view)).ok).toBe(false);
    }
    await t.run((ctx) => ctx.db.patch(prior.release, { version: "1.1.0" }));
    expect((await t.fetch(view + "&version=1.1.0")).status).toBe(422);
  });
});
