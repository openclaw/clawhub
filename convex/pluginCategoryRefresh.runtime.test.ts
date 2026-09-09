/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = convexTest({ schema, modules });
  const { userId, publisherId } = await t.run(async (ctx) => {
    const createdUserId = await ctx.db.insert("users", { handle: "category-proof" });
    const createdPublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "category-proof",
      displayName: "Category proof",
      linkedUserId: createdUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId: createdUserId, publisherId: createdPublisherId };
  });
  const publish = async (version: string, declared?: string[]) =>
    t.mutation(internal.packages.insertReleaseInternal, {
      actorUserId: userId,
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      name: "@category-proof/appointments",
      displayName: "Appointments",
      family: "code-plugin",
      version,
      changelog: "Fixture",
      summary: "Manage appointments",
      tags: ["latest"],
      categories: ["tools"],
      channel: "community",
      files: [],
      integritySha256: version.padEnd(64, "0"),
      sha256hash: version.padEnd(64, "0"),
      extractedPluginManifest: {
        id: "appointments",
        description: "Manage appointments and availability.",
        ...(declared ? { categories: declared } : {}),
      },
      pluginManifestSummary: {
        schemaVersion: 1,
        categories: ["tools"],
        configFields: [],
        mcpServers: [],
        bundledSkills: [],
      },
    });
  await publish("1.0.0");
  const latest = await publish("2.0.0");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  categories: ["scheduling"],
                  evidence: "Manages appointments.",
                }),
              },
            ],
          },
        ],
      }),
    ),
  );
  const readCategories = () =>
    t.query(internal.packages.resolveVersionCategoriesBatchInternal, {
      packages: ["1.0.0", "2.0.0"].map((version) => ({
        name: "@category-proof/appointments",
        version,
      })),
    });
  return { t, publish, latest, readCategories, publisherId };
}

describe("latest plugin category refresh", () => {
  it("rejects superseded model previews, including rows accepted before a classifier upgrade", async () => {
    const { t, readCategories } = await fixture();
    const before = await readCategories();
    await t.action(internal.pluginCategoryRefresh.preview, { runId: "old-classifier" });
    const rows = await t.query(internal.pluginCategoryRefresh.list, {
      runId: "old-classifier",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const row = rows.page[0];
    await t.run(async (ctx) =>
      ctx.db.patch(row._id, {
        classification: {
          ...row.classification,
          classifierVersion: "plugin-product-categories-v1",
        },
      }),
    );
    await expect(
      t.mutation(internal.pluginCategoryRefresh.accept, {
        ids: [row._id],
        confirm: "apply-plugin-category-refresh",
      }),
    ).rejects.toThrow("Classifier changed");
    await t.run(async (ctx) => ctx.db.patch(row._id, { status: "accepted" }));
    await expect(
      t.mutation(internal.pluginCategoryRefresh.applyAccepted, { id: row._id }),
    ).resolves.toEqual({ applied: false });
    expect(await readCategories()).toEqual(before);
    expect((await t.run(async (ctx) => ctx.db.get(row._id)))?.status).toBe("stale");
  });

  it("preserves manifest details when a legacy release only has a stored manifest", async () => {
    const { t, latest } = await fixture();
    await t.run(async (ctx) => {
      const manifest = JSON.stringify({
        id: "appointments",
        categories: ["scheduling"],
        configSchema: { type: "object", properties: { apiKey: { type: "string" } } },
        mcpServers: { appointments: { command: "appointments" } },
      });
      const storageId = await ctx.storage.store(new Blob([manifest]));
      await ctx.db.patch(latest.releaseId, {
        extractedPluginManifest: undefined,
        pluginManifestSummary: undefined,
        files: [
          { path: "openclaw.plugin.json", size: manifest.length, sha256: "manifest", storageId },
        ],
      });
    });
    await t.action(internal.pluginCategoryRefresh.preview, { runId: "stored-manifest" });
    const rows = await t.query(internal.pluginCategoryRefresh.list, {
      runId: "stored-manifest",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    await t.mutation(internal.pluginCategoryRefresh.accept, {
      ids: [rows.page[0]._id],
      confirm: "apply-plugin-category-refresh",
    });
    await t.mutation(internal.pluginCategoryRefresh.applyAccepted, { id: rows.page[0]._id });
    const release = await t.run(async (ctx) => ctx.db.get(latest.releaseId));
    expect(release?.pluginManifestSummary).toMatchObject({
      categories: ["scheduling"],
      configFields: [{ name: "apiKey" }],
      mcpServers: [{ name: "appointments" }],
    });
    await t.mutation(internal.pluginCategoryRefresh.rollback, {
      id: rows.page[0]._id,
      confirm: "rollback-plugin-category-refresh",
    });
    expect(
      (await t.run(async (ctx) => ctx.db.get(latest.releaseId)))?.pluginManifestSummary,
    ).toBeUndefined();
  });

  it("uses reviewed bundled assignments only for verified OpenClaw package identities", async () => {
    const { t, latest, publisherId } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.patch(latest.packageId, {
        name: "@openclaw/imap",
        normalizedName: "@openclaw/imap",
      });
      await ctx.db.patch(latest.releaseId, {
        extractedPluginManifest: { id: "imap" },
        source: { repo: "openclaw/openclaw" },
      });
    });
    await t.action(internal.pluginCategoryRefresh.preview, { runId: "unverified" });
    const unverified = await t.query(internal.pluginCategoryRefresh.list, {
      runId: "unverified",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(unverified.page).toMatchObject([
      { categories: ["scheduling"], classification: { source: "generated" } },
    ]);
    await t.run(async (ctx) => ctx.db.patch(publisherId, { handle: "openclaw", kind: "org" }));
    await t.action(internal.pluginCategoryRefresh.preview, { runId: "verified" });
    const verified = await t.query(internal.pluginCategoryRefresh.list, {
      runId: "verified",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(verified.page).toMatchObject([
      { categories: ["inbox-collaboration"], classification: { source: "bundled" } },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([{ categories: ["tools"] }, { categories: ["productivity", "scheduling"] }])(
    "preserves explicit bundled release categories $categories through preview and apply",
    async ({ categories }) => {
      const { t, latest, publisherId } = await fixture();
      await t.run(async (ctx) => {
        await ctx.db.patch(publisherId, { handle: "openclaw", kind: "org" });
        await ctx.db.patch(latest.packageId, {
          name: "@openclaw/imap",
          normalizedName: "@openclaw/imap",
        });
        await ctx.db.patch(latest.releaseId, {
          extractedPluginManifest: { id: "imap", categories },
          source: { repo: "openclaw/openclaw" },
        });
      });
      await t.action(internal.pluginCategoryRefresh.preview, { runId: "bundled-declaration" });
      const rows = await t.query(internal.pluginCategoryRefresh.list, {
        runId: "bundled-declaration",
        paginationOpts: { cursor: null, numItems: 10 },
      });
      expect(rows.page).toMatchObject([{ categories, classification: { source: "manifest" } }]);
      await t.mutation(internal.pluginCategoryRefresh.accept, {
        ids: [rows.page[0]._id],
        confirm: "apply-plugin-category-refresh",
      });
      await t.mutation(internal.pluginCategoryRefresh.applyAccepted, { id: rows.page[0]._id });
      const exactVersion = await t.query(internal.packages.resolveVersionCategoriesBatchInternal, {
        packages: [{ name: "@openclaw/imap", version: "2.0.0" }],
      });
      expect(exactVersion[0].categories).toEqual(categories);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not overwrite a newer release or category edit after preview approval", async () => {
    const { t, publish, latest, readCategories } = await fixture();
    await t.action(internal.pluginCategoryRefresh.preview, { runId: "edited" });
    const edited = await t.query(internal.pluginCategoryRefresh.list, {
      runId: "edited",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    await t.mutation(internal.pluginCategoryRefresh.accept, {
      ids: [edited.page[0]._id],
      confirm: "apply-plugin-category-refresh",
    });
    await t.run(async (ctx) => ctx.db.patch(latest.packageId, { categories: ["productivity"] }));
    await expect(
      t.mutation(internal.pluginCategoryRefresh.applyAccepted, { id: edited.page[0]._id }),
    ).resolves.toEqual({ applied: false });
    await t.action(internal.pluginCategoryRefresh.preview, { runId: "new-release" });
    const changed = await t.query(internal.pluginCategoryRefresh.list, {
      runId: "new-release",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    await t.mutation(internal.pluginCategoryRefresh.accept, {
      ids: [changed.page[0]._id],
      confirm: "apply-plugin-category-refresh",
    });
    await publish("3.0.0", ["productivity"]);
    await expect(
      t.mutation(internal.pluginCategoryRefresh.applyAccepted, { id: changed.page[0]._id }),
    ).resolves.toEqual({ applied: false });
    expect((await readCategories()).map((item) => item.categories)).toEqual([["tools"], ["tools"]]);
  });

  it("keeps explicit categories and preserves a reviewed run when preview restarts", async () => {
    const { t, publish } = await fixture();
    await publish("3.0.0", ["productivity", "scheduling"]);
    await t.action(internal.pluginCategoryRefresh.preview, { runId: "declared" });
    const first = await t.query(internal.pluginCategoryRefresh.list, {
      runId: "declared",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(first.page).toMatchObject([
      { categories: ["productivity", "scheduling"], classification: { source: "manifest" } },
    ]);
    expect(fetch).not.toHaveBeenCalled();
    await t.mutation(internal.pluginCategoryRefresh.accept, {
      ids: [first.page[0]._id],
      confirm: "apply-plugin-category-refresh",
    });
    await t.action(internal.pluginCategoryRefresh.preview, { runId: "declared" });
    const resumed = await t.query(internal.pluginCategoryRefresh.list, {
      runId: "declared",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(resumed.page).toHaveLength(1);
    expect(resumed.page[0].status).toBe("accepted");
  });

  it("previews without changing reads, applies only an accepted latest release, and can roll it back", async () => {
    const { t, readCategories } = await fixture();
    const preview = await t.action(internal.pluginCategoryRefresh.preview, { runId: "proof" });
    expect(preview.isDone).toBe(true);
    const rows = await t.query(internal.pluginCategoryRefresh.list, {
      runId: "proof",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(rows.page).toMatchObject([
      {
        categories: ["scheduling"],
        beforeCategories: ["tools"],
        status: "preview",
        version: "2.0.0",
      },
    ]);
    expect((await readCategories()).map((item) => item.categories)).toEqual([["tools"], ["tools"]]);
    await t.mutation(internal.pluginCategoryRefresh.applyAccepted, { id: rows.page[0]._id });
    expect((await readCategories())[1].categories).toEqual(["tools"]);
    await t.mutation(internal.pluginCategoryRefresh.accept, {
      ids: [rows.page[0]._id],
      confirm: "apply-plugin-category-refresh",
    });
    await t.mutation(internal.pluginCategoryRefresh.applyAccepted, { id: rows.page[0]._id });
    expect((await readCategories()).map((item) => item.categories)).toEqual([
      ["tools"],
      ["scheduling"],
    ]);
    const page = await t.query(api.packages.listPublicPage, {
      family: "code-plugin",
      category: "scheduling",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page.map((pkg) => pkg.name)).toEqual(["@category-proof/appointments"]);
    await t.mutation(internal.pluginCategoryRefresh.rollback, {
      id: rows.page[0]._id,
      confirm: "rollback-plugin-category-refresh",
    });
    expect((await readCategories()).map((item) => item.categories)).toEqual([["tools"], ["tools"]]);
  });
});
