/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());
const reservation = {
  id: "plugin:community-workflow",
  name: "community-workflow",
  displayName: "Community workflow",
  reason: "An editorial choice that remains reserved before publication.",
};

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  registerWorkpool(t, "searchReports");
  const actor = await t.run((ctx) =>
    ctx.db.insert("users", { handle: "curator", role: "moderator" }),
  );
  return { t, staff: t.withIdentity({ subject: `${actor}|test-session` }) };
}

describe("editable Featured reservations", () => {
  it("reserves missing editorial identities without publishing, and rejects a stale overwrite", async () => {
    const { t, staff } = await fixture();
    await staff.mutation(api.featuredSelections.saveEditorial, {
      expectedRevision: 0,
      items: [reservation],
    });
    const saved = await staff.query(api.featuredSelections.get, { artifactKind: "plugin" });
    expect(saved).toMatchObject({
      revision: 1,
      editorial: [reservation],
      published: null,
      reservations: [
        { ...reservation, currentArtifact: null, pendingReasons: ["not-in-public-catalog"] },
      ],
    });
    await expect(
      staff.mutation(api.featuredSelections.saveEditorial, { expectedRevision: 0, items: [] }),
    ).rejects.toThrow(/changed|revision/i);
    expect(
      (await staff.query(api.featuredSelections.get, { artifactKind: "plugin" })).editorial,
    ).toEqual([reservation]);
    expect(await t.run((ctx) => ctx.db.query("packageBadges").collect())).toEqual([]);
    expect(
      (await staff.query(api.featuredSelections.get, { artifactKind: "skill" })).editorial,
    ).toEqual([]);
  });

  it("rejects anonymous edits, duplicate identities, invalid identities and more than eight reservations", async () => {
    const { t, staff } = await fixture();
    await expect(
      t.mutation(api.featuredSelections.saveEditorial, { expectedRevision: 0, items: [] }),
    ).rejects.toThrow(/Unauthorized/);
    for (const items of [
      [reservation, reservation],
      [{ ...reservation, id: "clawhub:other" }],
      Array.from({ length: 9 }, (_, i) => ({
        ...reservation,
        id: `plugin:workflow-${i}`,
        name: `workflow-${i}`,
      })),
    ]) {
      await expect(
        staff.mutation(api.featuredSelections.saveEditorial, { expectedRevision: 0, items }),
      ).rejects.toThrow();
    }
    expect(
      (await staff.query(api.featuredSelections.get, { artifactKind: "plugin" })).revision,
    ).toBe(0);
  });
});

it.each(["plugin", "skill"] as const)(
  "publishes the approved %s report atomically, preserving retained badges and rejecting altered evidence",
  async (artifactKind) => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 16));
    const { t, staff } = await fixture();
    const actorUserId = await t.run(async (ctx) => (await ctx.db.query("users").first())!._id);
    const items = await t.run(async (ctx) => {
      const seededItems = [];
      const storageId = await ctx.storage.store(new Blob(["fixture"]));
      const files = [{ path: "SKILL.md", size: 7, storageId, sha256: "a".repeat(64) }];
      for (let i = 0; i < 17; i++) {
        const name = `workflow-${i}`;
        let id: string;
        if (artifactKind === "plugin") {
          const packageId = await ctx.db.insert("packages", {
            name,
            normalizedName: name,
            displayName: name,
            family: "code-plugin",
            ownerUserId: actorUserId,
            channel: "community",
            isOfficial: false,
            categories: ["developer-tools"],
            tags: {},
            scanStatus: "clean",
            stats: { downloads: 1, installs: 1, stars: 0, versions: 1 },
            createdAt: 1,
            updatedAt: 1,
          });
          const releaseId = await ctx.db.insert("packageReleases", {
            packageId,
            version: "1.0.0",
            changelog: "Initial",
            distTags: ["latest"],
            files,
            integritySha256: "a".repeat(64),
            verification: { tier: "structural", scope: "artifact-only", scanStatus: "clean" },
            createdBy: actorUserId,
            createdAt: 1,
          });
          await ctx.db.patch(packageId, {
            latestReleaseId: releaseId,
            tags: { latest: releaseId },
          });
          for (const [daysAgo, installs] of [
            [20, 38 - i],
            [1, 2],
          ])
            await ctx.db.insert("packageDailyStats", {
              packageId,
              day: Math.floor(Date.now() / 86_400_000) - daysAgo,
              installs,
              downloads: 0,
              updatedAt: Date.now(),
            });
          if (i === 0 || i === 16)
            await ctx.db.insert("packageBadges", {
              packageId,
              kind: "highlighted",
              byUserId: actorUserId,
              at: 1,
            });
          id = `plugin:${name}`;
        } else {
          const skillId = await ctx.db.insert("skills", {
            slug: name,
            displayName: name,
            ownerUserId: actorUserId,
            tags: {},
            stats: { comments: 0, downloads: 1, stars: 0, versions: 1 },
            createdAt: 1,
            updatedAt: 1,
          });
          const versionId = await ctx.db.insert("skillVersions", {
            skillId,
            version: "1.0.0",
            changelog: "Initial",
            files,
            parsed: { frontmatter: {} },
            createdBy: actorUserId,
            createdAt: 1,
            llmAnalysis: { status: "clean", checkedAt: 1 },
          });
          await ctx.db.patch(skillId, { latestVersionId: versionId });
          for (const [daysAgo, installs] of [
            [20, 38 - i],
            [1, 2],
          ])
            await ctx.db.insert("skillDailyStats", {
              skillId,
              day: Math.floor(Date.now() / 86_400_000) - daysAgo,
              installs,
              downloads: 0,
              updatedAt: Date.now(),
            });
          if (i === 0 || i === 16)
            await ctx.db.insert("skillBadges", {
              skillId,
              kind: "highlighted",
              byUserId: actorUserId,
              at: 1,
            });
          id = `clawhub:${skillId}`;
        }
        seededItems.push({
          id,
          version: "1.0.0",
          selectionBasis:
            artifactKind === "plugin" && i < 8 ? ("editorial" as const) : ("telemetry" as const),
          reason: "Approved fixture selection",
          ...(artifactKind === "skill" || i >= 8 ? { installs30d: 40 - i, installs7d: 2 } : {}),
        });
      }
      return seededItems;
    });
    if (artifactKind === "plugin")
      await staff.mutation(api.featuredSelections.saveEditorial, {
        expectedRevision: 0,
        items: items.slice(0, 8).map((item) => ({
          id: item.id,
          name: item.id.slice(7),
          displayName: item.id.slice(7),
          reason: item.reason,
        })),
      });
    const queued = await staff.mutation(api.searchReports.start, {
      view: "recommendations",
      artifactKind,
      window: 30,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const ready = await staff.action(api.searchReports.get, { reportId: queued.reportId });
    if (ready.status !== "ready" || ready.view !== "recommendations")
      throw new Error(`Expected generated recommendation report: ${JSON.stringify(ready)}`);
    const payload = {
      reportId: queued.reportId,
      artifactKind,
      expectedEditorialRevision: artifactKind === "plugin" ? 1 : 0,
      expectedPublicationAt: null,
      periodStart: Date.UTC(2026, 7, 17),
      periodEnd: Date.UTC(2026, 8, 16),
      items: ready.report.recommendations.lineup.proposed.map((item) => ({
        id: item.id,
        version: item.version!,
        selectionBasis: item.selectionBasis,
        reason: item.reason,
        ...(item.adoption
          ? { installs30d: item.adoption.installs30d, installs7d: item.adoption.installs7d }
          : {}),
      })),
    };
    const snapshot = () =>
      t.run(async (ctx) => ({
        badges: await ctx.db
          .query(artifactKind === "plugin" ? "packageBadges" : "skillBadges")
          .collect(),
        audits: await ctx.db.query("auditLogs").collect(),
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      }));
    const before = await snapshot();
    await expect(
      staff.mutation(api.featuredSelections.publish, {
        ...payload,
        dryRun: true,
        items: payload.items.map((item, index) =>
          index === 15 ? { ...item, installs30d: item.installs30d! + 1 } : item,
        ),
      }),
    ).rejects.toThrow(/report|evidence/i);
    await expect(
      staff.mutation(api.featuredSelections.publish, {
        ...payload,
        dryRun: false,
        items: payload.items.map((item, i) =>
          i === 15 ? { ...item, version: "old-version" } : item,
        ),
      }),
    ).rejects.toThrow(/changed.*report/i);
    const swapped = [...payload.items];
    [swapped[14], swapped[15]] = [swapped[15], swapped[14]];
    for (const changed of [
      { items: swapped },
      { periodStart: payload.periodStart - 86_400_000, periodEnd: payload.periodEnd - 86_400_000 },
      {
        items: payload.items.map((item, index) =>
          index === 15 ? { ...item, id: items[16].id } : item,
        ),
      },
    ])
      await expect(
        staff.mutation(api.featuredSelections.publish, {
          ...payload,
          ...changed,
          dryRun: true,
        }),
      ).rejects.toThrow(/report/i);
    expect(await snapshot()).toEqual(before);
    const changedVersionId = await t.run(async (ctx) => {
      const selectedId = payload.items[15].id;
      const versionId =
        artifactKind === "plugin"
          ? (await ctx.db
              .query("packages")
              .withIndex("by_name", (q) => q.eq("normalizedName", selectedId.slice(7)))
              .unique())!.latestReleaseId!
          : (await ctx.db.get(ctx.db.normalizeId("skills", selectedId.slice(8))!))!
              .latestVersionId!;
      await ctx.db.patch(versionId, { version: "2.0.0" });
      return versionId;
    });
    await expect(
      staff.mutation(api.featuredSelections.publish, { ...payload, dryRun: false }),
    ).rejects.toThrow(/version changed/i);
    expect(await snapshot()).toEqual(before);
    await t.run((ctx) => ctx.db.patch(changedVersionId, { version: "1.0.0" }));
    await staff.mutation(api.featuredSelections.publish, { ...payload, dryRun: true });
    expect(await snapshot()).toEqual(before);
    await staff.mutation(api.featuredSelections.publish, { ...payload, dryRun: false });
    const state = await staff.query(api.featuredSelections.get, { artifactKind });
    expect(state.published?.items).toEqual(payload.items);
    expect(state.published).toMatchObject({
      reportId: queued.reportId,
      reportHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const after = await snapshot();
    expect(after.badges).toHaveLength(16);
    expect(after.badges.find((badge) => badge._id === before.badges[0]._id)).toEqual(
      before.badges[0],
    );
    expect(after.badges.some((badge) => badge._id === before.badges[1]._id)).toBe(false);
    expect(after.scheduled).toEqual(before.scheduled);
    await expect(
      staff.mutation(api.featuredSelections.publish, { ...payload, dryRun: false }),
    ).rejects.toThrow(/publication changed/i);
    vi.setSystemTime(queued.expirationTime);
    await expect(
      staff.mutation(api.featuredSelections.publish, {
        ...payload,
        expectedPublicationAt: state.published!.at,
        dryRun: true,
      }),
    ).rejects.toThrow(/report unavailable/i);
  },
);

it("exposes revision-checked editorial changes only to authenticated staff over HTTP", async () => {
  const { t } = await fixture();
  await t.run(async (ctx) => {
    const moderator = (await ctx.db.query("users").first())!;
    const ordinary = await ctx.db.insert("users", { handle: "reader", role: "user" });
    for (const [userId, token] of [
      [moderator._id, "staff-fixture"],
      [ordinary, "reader-fixture"],
    ] as const) {
      await ctx.db.insert("apiTokens", {
        userId,
        label: "fixture",
        prefix: "fixture",
        tokenHash: await hashToken(token),
        createdAt: 1,
      });
    }
  });
  const path = "/api/v1/featured/plugin";
  expect((await t.fetch(path)).status).toBe(401);
  expect(
    (await t.fetch(path, { headers: { Authorization: "Bearer reader-fixture" } })).status,
  ).toBe(403);
  const headers = { Authorization: "Bearer staff-fixture", "Content-Type": "application/json" };
  const initial = await t.fetch(path, { headers });
  expect(initial.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await initial.json()).toMatchObject({ revision: 0, editorial: [] });
  const save = () =>
    t.fetch(`${path}/editorial`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: 0, items: [reservation] }),
    });
  expect((await save()).status).toBe(200);
  expect((await save()).status).toBe(409);
  expect(await (await t.fetch(path, { headers })).json()).toMatchObject({
    revision: 1,
    editorial: [reservation],
  });
  expect(
    (await t.fetch("/api/v1/featured/skill/editorial", { method: "POST", headers, body: "{}" }))
      .status,
  ).toBe(404);
});
