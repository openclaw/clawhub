/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const hiddenText = "Synthetic quarantined content, never send to the provider";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setupPreview() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { handle: "owner" });
    const outsiderId = await ctx.db.insert("users", { handle: "outsider" });
    const skillId = await ctx.db.insert("skills", {
      slug: "quarantined",
      displayName: "Quarantined",
      ownerUserId: ownerId,
      tags: {},
      moderationStatus: "hidden",
      moderationReason: "scanner.test.malicious",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const storageId = await ctx.storage.store(new Blob([hiddenText]));
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "1.0.0",
      changelog: "Initial",
      parsed: { frontmatter: {} },
      files: [{ path: "SKILL.md", size: hiddenText.length, storageId, sha256: "a".repeat(64) }],
      createdBy: ownerId,
      createdAt: 1,
    });
    await ctx.db.patch(skillId, { latestVersionId: versionId });
    return { ownerId, outsiderId, skillId, versionId };
  });
  vi.stubEnv("OPENAI_API_KEY", "local-provider-fixture");
  const provider = vi.fn(
    async (_input: unknown, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          output: [
            { type: "message", content: [{ type: "output_text", text: "Provider answer" }] },
          ],
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      ),
  );
  vi.stubGlobal("fetch", provider);
  return { t, provider, ...ids };
}

it("rejects an outsider's quarantined-content preview before calling the provider", async () => {
  const { t, outsiderId, provider } = await setupPreview();
  await expect(
    t.withIdentity({ subject: outsiderId }).action(api.skills.generateChangelogPreview, {
      slug: "quarantined",
      version: "1.0.1",
      readmeText: "New readme",
      filePaths: ["SKILL.md"],
    }),
  ).rejects.toThrow("Version not available");
  expect(provider).not.toHaveBeenCalled();
});

it.each(["pending", "blocked", "deleted"])(
  "rejects an outsider's %s version without a provider call",
  async (state) => {
    const { t, outsiderId, provider, skillId, versionId } = await setupPreview();
    await t.run(async (ctx) => {
      await ctx.db.patch(skillId, { moderationStatus: "active", moderationReason: undefined });
      if (state === "deleted") await ctx.db.patch(versionId, { softDeletedAt: 2 });
      else await ctx.db.patch(versionId, { publicationStatus: state as "pending" | "blocked" });
    });
    await expect(
      t.withIdentity({ subject: outsiderId }).action(api.skills.generateChangelogPreview, {
        slug: "quarantined",
        version: "1.0.1",
        readmeText: "New readme",
      }),
    ).rejects.toThrow("Version not available");
    expect(provider).not.toHaveBeenCalled();
  },
);

it.each(["public", "owner"])("preserves previews with authorized %s content", async (access) => {
  const { t, outsiderId, ownerId, provider, skillId } = await setupPreview();
  if (access === "public")
    await t.run((ctx) =>
      ctx.db.patch(skillId, {
        moderationStatus: "active",
        moderationReason: undefined,
      }),
    );
  await expect(
    t
      .withIdentity({ subject: access === "owner" ? ownerId : outsiderId })
      .action(api.skills.generateChangelogPreview, {
        slug: "quarantined",
        version: "1.0.1",
        readmeText: "New readme",
      }),
  ).resolves.toEqual({ changelog: "Provider answer", source: "auto" });
  expect(provider).toHaveBeenCalledOnce();
  expect(provider.mock.calls[0]?.[1]?.body).toContain(hiddenText);
});

it("allows an initial-release preview without loading another skill's content", async () => {
  const { t, outsiderId, provider } = await setupPreview();
  await expect(
    t.withIdentity({ subject: outsiderId }).action(api.skills.generateChangelogPreview, {
      slug: "new-skill",
      version: "1.0.0",
      readmeText: "New readme",
    }),
  ).resolves.toEqual({ changelog: "Provider answer", source: "auto" });
  expect(provider.mock.calls[0]?.[1]?.body).not.toContain(hiddenText);
});
