/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { MANAGED_MCP_DEFINITION_PATH } from "clawhub-schema";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { sha256Hex } from "./lib/clawpack";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");

async function fixture(role: "user" | "admin") {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { handle: "managed-author", role });
    await ctx.db.insert("apiTokens", {
      userId: id,
      label: "local test",
      prefix: "test",
      tokenHash: await hashToken("managed-test"),
      createdAt: 1,
    });
    return id;
  });
  return { t, userId, ui: t.withIdentity({ subject: `${userId}|test-session` }) };
}

async function publicationFixture() {
  const context = await fixture("admin");
  const { t, userId } = context;
  const definition = {
    id: "managed-proof",
    name: "Managed proof",
    company: "Example",
    description: "Managed integration authorization fixture.",
    category: "integrations",
    version: "1.0.0",
    icon: {
      pngBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1kAAAAASUVORK5CYII=",
      license: "MIT",
      attribution: "OpenClaw",
    },
    connection: {
      url: "https://mcp.example.com/mcp",
      transport: "streamable-http",
      auth: { kind: "none" },
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(definition));
  const values = await t.run(async (ctx) => {
    const publisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    });
    const membershipId = await ctx.db.insert("publisherMembers", {
      publisherId,
      userId,
      role: "publisher",
      createdAt: 1,
      updatedAt: 1,
    });
    const storageId = await ctx.storage.store(new Blob([bytes]));
    return { publisherId, membershipId, storageId };
  });
  const { publisherId, membershipId, storageId } = values;
  const submission = {
    actorUserId: userId,
    ownerUserId: userId,
    ownerPublisherId: publisherId,
    publishActor: { kind: "user" as const, userId },
    name: "@openclaw/managed-proof",
    displayName: "Managed proof",
    family: "bundle-plugin" as const,
    version: "1.0.0",
    publicationStatus: "pending" as const,
    changelog: "Fixture",
    summary: "Fixture",
    tags: ["latest"],
    files: [
      {
        path: MANAGED_MCP_DEFINITION_PATH,
        size: bytes.byteLength,
        storageId,
        sha256: await sha256Hex(bytes),
      },
    ],
    integritySha256: "b".repeat(64),
    sha256hash: "c".repeat(64),
  };
  return { ...context, publisherId, membershipId, submission, definition };
}

describe("managed MCP authorization", () => {
  it("requires a new version for icon edits and keeps the old release until publication", async () => {
    const { t, ui, submission, definition } = await publicationFixture();
    const original = await t.mutation(internal.packages.insertReleaseInternal, submission);
    await t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: original.releaseId,
    });
    const nextDefinition = {
      ...definition,
      version: "1.0.1",
      icon: {
        ...definition.icon,
        pngBase64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
        license: "Provider brand terms",
        attribution: "Example logo belongs to Example.",
        sourceUrl: "https://example.com/brand/icon.png",
        licenseUrl: "https://example.com/brand/terms",
      },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(nextDefinition));
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes])));
    const edited = {
      ...submission,
      integritySha256: "d".repeat(64),
      sha256hash: "e".repeat(64),
      files: [
        {
          path: MANAGED_MCP_DEFINITION_PATH,
          size: bytes.byteLength,
          storageId,
          sha256: await sha256Hex(bytes),
        },
      ],
    };
    await expect(t.mutation(internal.packages.insertReleaseInternal, edited)).rejects.toThrow(
      "Version 1.0.0 already exists",
    );
    const next = await t.mutation(internal.packages.insertReleaseInternal, {
      ...edited,
      version: "1.0.1",
    });
    expect((await t.run((ctx) => ctx.db.get(original.packageId)))?.latestReleaseId).toBe(
      original.releaseId,
    );
    expect((await t.run((ctx) => ctx.db.get(next.releaseId)))?.publicationStatus).toBe("pending");
    expect(await ui.action(api.managedMcp.getDefinition, { id: definition.id })).toEqual(
      nextDefinition,
    );

    // Model successful security finalization; this test does not run external scanners.
    await t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: next.releaseId,
    });
    expect((await t.run((ctx) => ctx.db.get(original.packageId)))?.latestReleaseId).toBe(
      next.releaseId,
    );
    const old = await t.run((ctx) => ctx.db.get(original.releaseId));
    expect(old?.files).toEqual(submission.files);
    expect(old?.integritySha256).toBe(submission.integritySha256);
    expect(old?.publicationStatus).toBe("published");
  });

  it("denies UI and CLI reads and unpublication to an administrator without publishing membership", async () => {
    const { t, ui, userId, membershipId, submission } = await publicationFixture();
    const staged = await t.mutation(internal.packages.insertReleaseInternal, submission);
    await t.run((ctx) => ctx.db.delete(membershipId));
    await expect(ui.action(api.managedMcp.getDefinition, { id: "managed-proof" })).rejects.toThrow(
      "Forbidden",
    );
    await expect(ui.action(api.managedMcp.unpublish, { id: "managed-proof" })).rejects.toThrow(
      "Forbidden",
    );
    await expect(
      t.query(internal.managedMcp.getReleaseInternal, { actorUserId: userId, id: "new-plugin" }),
    ).rejects.toThrow("Forbidden");
    const headers = { Authorization: "Bearer managed-test" };
    expect(
      (await t.fetch("/api/v1/packages/-/managed-mcp/managed-proof", { headers })).status,
    ).toBe(403);
    expect(
      (
        await t.fetch("/api/v1/packages/-/managed-mcp/managed-proof/unpublish", {
          method: "POST",
          headers,
        })
      ).status,
    ).toBe(403);
    expect((await t.run((ctx) => ctx.db.get(staged.packageId)))?.softDeletedAt).toBeUndefined();
  });

  it.each(["UI", "CLI"])(
    "allows authorized managed reads and unpublication through %s",
    async (surface) => {
      const { t, ui, submission, definition } = await publicationFixture();
      const staged = await t.mutation(internal.packages.insertReleaseInternal, submission);
      if (surface === "UI") {
        await expect(
          ui.action(api.managedMcp.getDefinition, { id: "managed-proof" }),
        ).resolves.toEqual(definition);
        await expect(ui.action(api.managedMcp.unpublish, { id: "managed-proof" })).resolves.toEqual(
          { ok: true },
        );
      } else {
        const headers = { Authorization: "Bearer managed-test" };
        const response = await t.fetch("/api/v1/packages/-/managed-mcp/managed-proof", { headers });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(definition);
        expect(
          (
            await t.fetch("/api/v1/packages/-/managed-mcp/managed-proof/unpublish", {
              method: "POST",
              headers,
            })
          ).status,
        ).toBe(200);
      }
      expect((await t.run((ctx) => ctx.db.get(staged.packageId)))?.softDeletedAt).toBeTypeOf(
        "number",
      );
      expect((await t.run((ctx) => ctx.db.get(staged.releaseId)))?.softDeletedAt).toBeTypeOf(
        "number",
      );
    },
  );

  it.each(["removed membership", "admin demotion", "deactivated actor", "deactivated publisher"])(
    "rechecks authorization in the unpublish transaction after %s",
    async (revocation) => {
      const { t, userId, publisherId, membershipId, submission } = await publicationFixture();
      const staged = await t.mutation(internal.packages.insertReleaseInternal, submission);
      const args = { actorUserId: userId, id: "managed-proof" };
      expect(await t.query(internal.managedMcp.getReleaseInternal, args)).not.toBeNull();
      await t.run(async (ctx) => {
        if (revocation === "removed membership") await ctx.db.delete(membershipId);
        if (revocation === "admin demotion") await ctx.db.patch(userId, { role: "user" });
        if (revocation === "deactivated actor")
          await ctx.db.patch(userId, { deactivatedAt: Date.now() });
        if (revocation === "deactivated publisher")
          await ctx.db.patch(publisherId, { deactivatedAt: Date.now() });
      });
      await expect(t.mutation(internal.managedMcp.unpublishForAdminInternal, args)).rejects.toThrow(
        revocation === "deactivated actor"
          ? "Unauthorized"
          : revocation === "deactivated publisher"
            ? "Publisher not found"
            : "Forbidden",
      );
      expect((await t.run((ctx) => ctx.db.get(staged.packageId)))?.softDeletedAt).toBeUndefined();
      expect((await t.run((ctx) => ctx.db.get(staged.releaseId)))?.softDeletedAt).toBeUndefined();
    },
  );

  it("rejects an administrator without organization publishing membership before staging", async () => {
    const { t, membershipId, submission } = await publicationFixture();
    await t.run((ctx) => ctx.db.delete(membershipId));
    await expect(t.mutation(internal.packages.insertReleaseInternal, submission)).rejects.toThrow(
      "publish access",
    );
    expect(await t.run((ctx) => ctx.db.query("packageReleases").collect())).toEqual([]);
  });

  it.each(["removed membership", "admin demotion", "deactivated actor", "deactivated publisher"])(
    "keeps a staged managed release private after %s",
    async (revocation) => {
      const { t, userId, publisherId, membershipId, submission } = await publicationFixture();
      const staged = await t.mutation(internal.packages.insertReleaseInternal, submission);
      await t.run(async (ctx) => {
        if (revocation === "removed membership") await ctx.db.delete(membershipId);
        if (revocation === "admin demotion") await ctx.db.patch(userId, { role: "user" });
        if (revocation === "deactivated actor")
          await ctx.db.patch(userId, { deactivatedAt: Date.now() });
        if (revocation === "deactivated publisher")
          await ctx.db.patch(publisherId, { deactivatedAt: Date.now() });
      });
      await expect(
        t.mutation(internal.packages.publishPendingReleaseInternal, {
          releaseId: staged.releaseId,
        }),
      ).rejects.toThrow();
      const saved = await t.run(async (ctx) => ({
        release: await ctx.db.get(staged.releaseId),
        pkg: await ctx.db.get(staged.packageId),
      }));
      expect(saved.release?.publicationStatus).toBe("pending");
      expect(saved.pkg?.latestReleaseId).toBeUndefined();
      expect(saved.pkg?.stats.versions).toBe(0);
      expect((await t.fetch("/api/v1/packages/@openclaw/managed-proof/download")).status).toBe(404);
    },
  );

  it("publishes a staged managed release while its administrator retains publishing access", async () => {
    const { t, submission } = await publicationFixture();
    const staged = await t.mutation(internal.packages.insertReleaseInternal, submission);
    await t.mutation(internal.packages.publishPendingReleaseInternal, {
      releaseId: staged.releaseId,
    });
    expect((await t.run((ctx) => ctx.db.get(staged.releaseId)))?.publicationStatus).toBe(
      "published",
    );
  });

  it("rejects both UI and CLI writes from a normal user before generating artifacts", async () => {
    const { t, ui } = await fixture("user");
    await expect(ui.action(api.managedMcp.publish, { definition: {} })).rejects.toThrow(
      "Forbidden",
    );
    const response = await t.fetch("/api/v1/packages/-/managed-mcp", {
      method: "POST",
      headers: { Authorization: "Bearer managed-test", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(await t.run((ctx) => ctx.db.query("packages").collect())).toEqual([]);
  });

  it("does not let an internal actor id bypass the admin boundary", async () => {
    const { t, userId } = await fixture("user");
    await expect(
      t.action(internal.managedMcp.publishForAdminInternal, {
        actorUserId: userId,
        definition: {},
      }),
    ).rejects.toThrow("Forbidden");
    await expect(
      t.mutation(internal.managedMcp.unpublishForAdminInternal, {
        actorUserId: userId,
        id: "demo",
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("validates UI and CLI definitions through the same backend and never reflects secret input", async () => {
    const { t, ui } = await fixture("admin");
    const definition = { clientSecret: "do-not-reflect-this" };
    await expect(ui.action(api.managedMcp.publish, { definition })).rejects.toThrow(
      "Invalid managed MCP definition fields",
    );
    const response = await t.fetch("/api/v1/packages/-/managed-mcp", {
      method: "POST",
      headers: { Authorization: "Bearer managed-test", "Content-Type": "application/json" },
      body: JSON.stringify(definition),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("do-not-reflect-this");
  });

  it("refuses to overwrite an unrelated package with the same identity", async () => {
    const { t, userId } = await publicationFixture();
    await t.run((ctx) =>
      ctx.db.insert("packages", {
        name: "@openclaw/demo",
        normalizedName: "@openclaw/demo",
        displayName: "Demo",
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        ownerUserId: userId,
        tags: {},
        stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await expect(
      t.query(internal.managedMcp.getReleaseInternal, { actorUserId: userId, id: "demo" }),
    ).rejects.toThrow("Package identity is already in use");
  });
});
