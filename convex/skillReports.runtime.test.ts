/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import { MAX_ACTIVE_REPORTS_PER_USER } from "./lib/reporting";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

it.each([false, true])(
  "keeps a skill public after four reports (official=%s) until a moderator acts",
  async (official) => {
    const t = convexTest(schema, modules);
    const { skillId, reporters } = await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", { handle: "owner" });
      const createdSkillId = await ctx.db.insert("skills", {
        slug: "reported-skill",
        displayName: "Reported skill",
        ownerUserId,
        tags: {},
        badges: official ? { official: { byUserId: ownerUserId, at: 1 } } : {},
        moderationStatus: "active",
        stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
        createdAt: 1,
        updatedAt: 1,
      });
      const createdReporters = [];
      for (let i = 0; i < 4; i++)
        createdReporters.push(await ctx.db.insert("users", { handle: `reporter-${i}` }));
      return { skillId: createdSkillId, reporters: createdReporters };
    });
    for (const userId of reporters) {
      await expect(
        t.withIdentity({ subject: userId }).mutation(api.skills.report, {
          skillId,
          reason: "Please review this skill",
        }),
      ).resolves.toMatchObject({ ok: true, reported: true });
    }
    const skill = await t.run((ctx) => ctx.db.get(skillId));
    expect(skill?.reportCount).toBe(4);
    expect(skill?.moderationStatus).toBe("active");
    expect(skill?.softDeletedAt).toBeUndefined();
    const reports = await t.run((ctx) => ctx.db.query("skillReports").collect());
    expect(reports).toHaveLength(4);
    expect(reports.every((report) => report.status === "open")).toBe(true);
    await expect(
      t.withIdentity({ subject: reporters[0] }).mutation(api.skills.report, {
        skillId,
        reason: "Repeated report",
      }),
    ).resolves.toMatchObject({ alreadyReported: true, reported: false });
    expect((await t.run((ctx) => ctx.db.get(skillId)))?.reportCount).toBe(4);
    await expect(
      t.withIdentity({ subject: reporters[0] }).mutation(api.skills.setSoftDeleted, {
        skillId,
        deleted: true,
        reason: "Reporter cannot make the moderation decision",
      }),
    ).rejects.toThrow("Forbidden");
    const moderator = await t.run((ctx) =>
      ctx.db.insert("users", { handle: "moderator", role: "moderator" }),
    );
    await t.withIdentity({ subject: moderator }).mutation(api.skills.setSoftDeleted, {
      skillId,
      deleted: true,
      reason: "Moderator reviewed the reports",
    });
    expect((await t.run((ctx) => ctx.db.get(skillId)))?.moderationStatus).toBe("hidden");
  },
);

it("returns the report message when the page report is rejected", async () => {
  const t = convexTest(schema, modules);
  const { reporterId, liveSkillId, removedSkillId, limitSkillId } = await t.run(async (ctx) => {
    const now = 1;
    const ownerId = await ctx.db.insert("users", { handle: "owner" });
    const createdReporterId = await ctx.db.insert("users", { handle: "reporter" });
    const createdLiveSkillId = await ctx.db.insert("skills", {
      slug: "live",
      displayName: "Live",
      ownerUserId: ownerId,
      tags: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: now,
      updatedAt: now,
    });
    const createdRemovedSkillId = await ctx.db.insert("skills", {
      slug: "removed",
      displayName: "Removed",
      ownerUserId: ownerId,
      tags: {},
      moderationStatus: "removed",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: now,
      updatedAt: now,
    });
    const createdLimitSkillId = await ctx.db.insert("skills", {
      slug: "limit",
      displayName: "Limit",
      ownerUserId: ownerId,
      tags: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: now,
      updatedAt: now,
    });
    for (let index = 0; index < MAX_ACTIVE_REPORTS_PER_USER; index += 1) {
      const skillId = await ctx.db.insert("skills", {
        slug: `filled-${index}`,
        displayName: "Filled",
        ownerUserId: ownerId,
        tags: {},
        moderationStatus: "active",
        stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("skillReports", {
        skillId,
        userId: createdReporterId,
        reason: "Existing report",
        status: "open",
        createdAt: now,
      });
    }
    return {
      reporterId: createdReporterId,
      liveSkillId: createdLiveSkillId,
      removedSkillId: createdRemovedSkillId,
      limitSkillId: createdLimitSkillId,
    };
  });

  const reporter = t.withIdentity({ subject: reporterId });
  await expect(
    reporter.mutation(api.skills.report, { skillId: liveSkillId, reason: "   " }),
  ).rejects.toBeInstanceOf(ConvexError);
  await expect(
    reporter.mutation(api.skills.report, { skillId: liveSkillId, reason: "   " }),
  ).rejects.toThrow("Report reason required.");
  await expect(
    reporter.mutation(api.skills.report, { skillId: removedSkillId, reason: "Hidden skill" }),
  ).rejects.toThrow("Skill not found");
  await expect(
    reporter.mutation(api.skills.report, { skillId: limitSkillId, reason: "One more" }),
  ).rejects.toThrow("Report limit reached. Please wait for moderation before reporting more.");
});
