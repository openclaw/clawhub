/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const reservation = {
  id: "plugin:community-workflow",
  name: "community-workflow",
  displayName: "Community workflow",
  reason: "An editorial choice that remains reserved before publication.",
};

async function fixture() {
  const t = convexTest(schema, modules);
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
