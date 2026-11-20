/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import { sha256Hex } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
const manifest = `---
schemaVersion: 1
agent:
  id: owl
  identity:
    avatar: images/owl.png
workspace:
  files:
    - { path: images/owl.png, source: media/owl.png }
---
`;
const confirm = "repair-template-artwork";
const rollbackConfirm = "rollback-template-artwork";
async function fixture() {
  const t = convexTest(schema, modules);
  const user = await t.run((ctx) => ctx.db.insert("users", { handle: "maker" }));
  const ownerPublisherId = await t.run((ctx) =>
    ctx.db.insert("publishers", {
      kind: "user",
      linkedUserId: user,
      handle: "maker",
      displayName: "Maker",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  async function publish(
    version = "1.0.0",
    options: {
      legacy?: boolean;
      icon?: string;
      family?: "claw" | "bundle-plugin";
      body?: string;
      pending?: boolean;
    } = {},
  ) {
    const name = "@maker/owl";
    const path = options.legacy ? "legacy/openclaw.claw.json" : "nested/CLAW.md";
    const files = [];
    for (const [filePath, contents] of [
      [
        "package.json",
        JSON.stringify({
          name,
          version,
          openclaw: { [options.legacy ? "claw" : "template"]: path },
        }),
      ],
      [
        path,
        options.body ??
          (options.legacy
            ? JSON.stringify({
                schemaVersion: 1,
                agent: { id: "owl", identity: { avatar: "images/owl.png" } },
                workspace: { files: [{ path: "images/owl.png", source: "media/owl.png" }] },
                profiles: { openclaw: "profile.json" },
              })
            : manifest),
      ],
      ["media/owl.png", png],
    ] as const) {
      const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
      const storageId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)])));
      files.push({ path: filePath, size: bytes.length, sha256: await sha256Hex(bytes), storageId });
    }
    return t.mutation(internal.packages.insertReleaseInternal, {
      actorUserId: user,
      ownerUserId: user,
      ownerPublisherId,
      name,
      displayName: "Owl",
      family: options.family ?? "claw",
      version,
      changelog: "Artwork test",
      tags: ["latest"],
      topics: ["birding"],
      channel: "community",
      files,
      summary: "Owls",
      sha256hash: "a".repeat(64),
      integritySha256: "a".repeat(64),
      icon: options.icon,
      ...(options.pending ? { publicationStatus: "pending" as const } : {}),
    });
  }
  const repair = internal.maintenance.repairTemplateArtworkInternal;
  const rollback = internal.maintenance.rollbackTemplateArtworkInternal;
  return { t, publish, repair, rollback };
}

it("previews one release without writing, applies its approved icon to every latest projection, and rolls back once", async () => {
  const { t, publish, repair, rollback } = await fixture();
  const { packageId, releaseId } = await publish();
  const state = () =>
    t.run(async (ctx) =>
      [
        (await ctx.db.get(releaseId))?.icon,
        (await ctx.db.get(packageId))?.icon,
        (await ctx.db.get(packageId))?.latestVersionSummary?.icon,
        (await ctx.db.query("packageSearchDigest").unique())?.icon,
        (await ctx.db.query("packageTopicSearchDigest").unique())?.icon,
      ].map((icon) => icon ?? null),
    );
  const before = await state();
  expect(before).toEqual(Array(5).fill(null));
  const preview = await t.action(repair, { packageId });
  expect(preview).toMatchObject({
    status: "would-repair",
    approval: { releaseId, icon: expect.stringMatching(/^\/api\/v1\/skill-icons\/[a-f0-9]{64}$/) },
  });
  const icon = preview.approval!.icon;
  expect(await state()).toEqual(before);
  expect(await t.run((ctx) => ctx.db.query("skillPresentationAssets").first())).toBeNull();
  const applied = await t.action(repair, {
    packageId,
    dryRun: false,
    confirm,
    approval: preview.approval!,
  });
  expect(applied.status).toBe("repaired");
  expect(await state()).toEqual(Array(5).fill(icon));
  expect((await t.action(repair, { packageId })).status).toBe("unchanged");
  const receiptId = applied.receiptId!;
  expect(await t.mutation(rollback, { receiptId })).toBe("would-rollback");
  expect(await t.mutation(rollback, { receiptId, dryRun: false, confirm: rollbackConfirm })).toBe(
    "rolled-back",
  );
  expect(await state()).toEqual(before);
  expect(await t.mutation(rollback, { receiptId })).toBe("already-rolled-back");
});

it("scans past an explicit latest icon to a prior JSON manifest, without changing the listing", async () => {
  const { t, publish, repair, rollback } = await fixture();
  const old = await publish("1.0.0", { legacy: true });
  const explicit = "/api/v1/skill-icons/" + "b".repeat(64);
  const latest = await publish("2.0.0", { icon: explicit });
  const first = await t.action(repair, { packageId: old.packageId });
  expect(first).toMatchObject({ status: "unchanged", releaseId: latest.releaseId, isDone: false });
  const args = { packageId: old.packageId, cursor: first.cursor };
  const oldPreview = await t.action(repair, args);
  expect(oldPreview).toMatchObject({ status: "would-repair", releaseId: old.releaseId });
  const applied = await t.action(repair, {
    ...args,
    approval: oldPreview.approval!,
    dryRun: false,
    confirm,
  });
  expect(applied.status).toBe("repaired");
  expect(await t.run((ctx) => ctx.db.get(old.releaseId))).toMatchObject({
    icon: oldPreview.approval!.icon,
  });
  expect(await t.run((ctx) => ctx.db.get(old.packageId))).toMatchObject({
    latestReleaseId: latest.releaseId,
    icon: explicit,
    latestVersionSummary: { icon: explicit },
  });
  expect(await t.run((ctx) => ctx.db.query("packageSearchDigest").unique())).toMatchObject({
    icon: explicit,
  });
  expect(
    await t.mutation(rollback, {
      receiptId: applied.receiptId!,
      dryRun: false,
      confirm: rollbackConfirm,
    }),
  ).toBe("rolled-back");
  expect(await t.run((ctx) => ctx.db.get(old.releaseId))).not.toHaveProperty("icon");
  expect(await t.run((ctx) => ctx.db.get(latest.releaseId))).toMatchObject({ icon: explicit });
});

it("requires approval of the exact preview, refuses stale publication and rollback, and recovers a committed receipt", async () => {
  const { t, publish, repair, rollback } = await fixture();
  const { packageId, releaseId } = await publish();
  const preview = await t.action(repair, { packageId });
  await expect(
    t.action(repair, { packageId, dryRun: false, approval: preview.approval! }),
  ).rejects.toThrow(/confirmation/);
  await expect(t.action(repair, { packageId, dryRun: false, confirm })).rejects.toThrow(/approval/);
  const applied = await t.action(repair, {
    packageId,
    dryRun: false,
    confirm,
    approval: preview.approval!,
  });
  const receipt = await t.query(internal.maintenance.getTemplateArtworkReceiptInternal, {
    releaseId,
  });
  expect(receipt).toMatchObject({
    receiptId: applied.receiptId,
    receipt: { packageId, releaseId, icon: preview.approval!.icon },
  });
  await expect(
    t.mutation(rollback, { receiptId: applied.receiptId!, dryRun: false }),
  ).rejects.toThrow(/confirmation/);
  const next = await publish("2.0.0");
  expect(
    (await t.action(repair, { packageId, dryRun: false, confirm, approval: preview.approval! }))
      .status,
  ).toBe("drifted");
  expect(
    await t.mutation(rollback, {
      receiptId: applied.receiptId!,
      dryRun: false,
      confirm: rollbackConfirm,
    }),
  ).toBe("drifted");
  expect(await t.run((ctx) => ctx.db.get(next.releaseId))).not.toHaveProperty("icon");
  expect(await t.run((ctx) => ctx.db.get(releaseId))).toMatchObject({
    icon: preview.approval!.icon,
  });
});

it.each(["alias", "oversized", "tampered", "mismatched-size", "undeclared"])(
  "does not recover an avatar from a %s manifest",
  async (mode) => {
    const { t, publish, repair } = await fixture();
    const { packageId, releaseId } = await publish("1.0.0", {
      body:
        mode === "alias"
          ? manifest.replace("id: owl", "id: &name owl")
          : mode === "oversized"
            ? manifest + "x".repeat(1024 * 1024)
            : mode === "undeclared"
              ? manifest.replace("avatar: images/owl.png", "avatar: media/owl.png")
              : manifest,
    });
    if (mode === "tampered" || mode === "mismatched-size")
      await t.run(async (ctx) => {
        const r = (await ctx.db.get(releaseId))!;
        await ctx.db.patch(releaseId, {
          files: r.files.map((f) =>
            f.path === "nested/CLAW.md"
              ? { ...f, ...(mode === "tampered" ? { sha256: "b".repeat(64) } : { size: 1 }) }
              : f,
          ),
        });
      });
    expect((await t.action(repair, { packageId })).status).toBe("no-eligible-artwork");
    expect(await t.run((ctx) => ctx.db.query("skillPresentationAssets").first())).toBeNull();
  },
);

it.each(["private", "moderated", "unpublished", "deleted", "owner-deleted", "bundle-plugin"])(
  "never stages artwork for a %s release",
  async (mode) => {
    const { t, publish, repair } = await fixture();
    const { packageId, releaseId } = await publish(
      "1.0.0",
      mode === "bundle-plugin" ? { family: "bundle-plugin" } : {},
    );
    await t.run(async (ctx) => {
      if (mode === "private") await ctx.db.patch(packageId, { channel: "private" });
      else if (mode === "moderated")
        await ctx.db.patch(releaseId, {
          verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "malicious" },
        });
      else if (mode === "unpublished")
        await ctx.db.patch(releaseId, { publicationStatus: "pending" });
      else if (mode === "deleted") await ctx.db.patch(releaseId, { softDeletedAt: 9 });
      else if (mode === "owner-deleted") await ctx.db.patch(releaseId, { ownerDeletedAt: 9 });
    });
    expect((await t.action(repair, { packageId })).status).toBe("ineligible");
    expect(await t.run((ctx) => ctx.db.query("skillPresentationAssets").first())).toBeNull();
  },
);

it("fixes a missing topic projection alone, and its receipt does not remove the three original icons", async () => {
  const { t, publish, repair, rollback } = await fixture();
  const { packageId, releaseId } = await publish();
  const first = await t.action(repair, { packageId });
  const original = await t.action(repair, {
    packageId,
    dryRun: false,
    confirm,
    approval: first.approval!,
  });
  const facet = await t.run(
    async (ctx) => (await ctx.db.query("packageTopicSearchDigest").unique())!._id,
  );
  await t.run((ctx) => ctx.db.patch(facet, { icon: undefined }));
  const partial = await t.action(repair, { packageId });
  expect(partial.status).toBe("would-repair");
  const next = await t.action(repair, {
    packageId,
    dryRun: false,
    confirm,
    approval: partial.approval!,
  });
  expect(next.status).toBe("repaired");
  expect(
    await t.mutation(rollback, {
      receiptId: original.receiptId!,
      dryRun: false,
      confirm: rollbackConfirm,
    }),
  ).toBe("drifted");
  expect(
    await t.mutation(rollback, {
      receiptId: next.receiptId!,
      dryRun: false,
      confirm: rollbackConfirm,
    }),
  ).toBe("rolled-back");
  expect(await t.run((ctx) => ctx.db.get(facet))).not.toHaveProperty("icon");
  expect(await t.run((ctx) => ctx.db.get(releaseId))).toMatchObject({ icon: first.approval!.icon });
  expect(await t.run((ctx) => ctx.db.get(packageId))).toMatchObject({
    icon: first.approval!.icon,
    latestVersionSummary: { icon: first.approval!.icon },
  });
});

it("uses a packaged PNG before a declared avatar and refuses to replace disagreeing artwork", async () => {
  const { t, publish, repair } = await fixture();
  const { releaseId, packageId } = await publish();
  await t.run(async (ctx) => {
    const r = (await ctx.db.get(releaseId))!;
    const source = r.files.find((file) => file.path === "media/owl.png")!;
    await ctx.db.patch(releaseId, { files: [...r.files, { ...source, path: "assets/icon.png" }] });
  });
  const a = await t.action(repair, { packageId });
  expect(a.approval?.icon).toBe("/api/v1/skill-icons/" + (await sha256Hex(png)));
  await t.run((ctx) => ctx.db.patch(packageId, { icon: "/api/v1/skill-icons/" + "f".repeat(64) }));
  expect((await t.action(repair, { packageId })).status).toBe("existing-artwork-conflict");
  expect(await t.run((ctx) => ctx.db.get(releaseId))).not.toHaveProperty("icon");
});

it("never registers an unapproved icon and rechecks the latest pointer inside the commit transaction", async () => {
  const { t, publish, repair } = await fixture();
  const { packageId, releaseId } = await publish();
  const preview = await t.action(repair, { packageId });
  const approval = preview.approval!;
  expect(
    (
      await t.action(repair, {
        packageId,
        dryRun: false,
        confirm,
        approval: { ...approval, icon: "/api/v1/skill-icons/" + "d".repeat(64) },
      })
    ).status,
  ).toBe("drifted");
  expect(await t.run((ctx) => ctx.db.query("skillPresentationAssets").first())).toBeNull();
  // Simulate a publish between the action's read/render and its final mutation.
  const newer = await publish("2.0.0");
  expect(
    await t.mutation(internal.maintenance.applyTemplateArtworkInternal, { packageId, approval }),
  ).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(releaseId))).not.toHaveProperty("icon");
  expect(await t.run((ctx) => ctx.db.get(newer.releaseId))).not.toHaveProperty("icon");
  expect(
    await t.query(internal.maintenance.getTemplateArtworkReceiptInternal, { releaseId }),
  ).toBeNull();
});
