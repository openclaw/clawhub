/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const prioritizeArgs = {
  confirm: "prioritize-doca-dpa-skill-evaluation" as const,
  sourcePath: "skills/doca-dpa" as const,
};

describe("skillEvaluations.prioritizeDocaDpaSkillEvaluation", () => {
  it("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.skillEvaluations.prioritizeDocaDpaSkillEvaluation, prioritizeArgs),
    ).rejects.toThrow(/Unauthorized/);
  });

  it("rejects a non-admin caller", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { handle: "member", role: "user" }));
    await expect(
      t
        .withIdentity({ subject: userId })
        .mutation(api.skillEvaluations.prioritizeDocaDpaSkillEvaluation, prioritizeArgs),
    ).rejects.toThrow(/Forbidden/);
  });

  it("lets an admin run the prioritize lookup", async () => {
    const t = convexTest(schema, modules);
    const adminId = await t.run((ctx) =>
      ctx.db.insert("users", { handle: "admin", role: "admin" }),
    );
    await expect(
      t
        .withIdentity({ subject: adminId })
        .mutation(api.skillEvaluations.prioritizeDocaDpaSkillEvaluation, prioritizeArgs),
    ).resolves.toEqual({ prioritized: false, reason: "source-missing" });
  });
});
