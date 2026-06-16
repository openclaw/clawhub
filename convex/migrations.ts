import { Migrations } from "@convex-dev/migrations";
import { internal, components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  buildPackageCatalogMetadataBackfillPatch,
  buildSkillCatalogMetadataBackfillPatch,
} from "./lib/catalogMetadataBackfill";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import { getOwnerPublisher } from "./lib/publishers";
import { extractValidatedDigestFields, upsertSkillSearchDigest } from "./lib/skillSearchDigest";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillSkillCatalogMetadata = migrations.define({
  table: "skills",
  batchSize: 50,
  migrateOne: async (ctx, skill) => {
    const patch = buildSkillCatalogMetadataBackfillPatch(skill);
    const nextSkill = { ...skill, ...patch };
    if (Object.keys(patch).length) await ctx.db.patch(skill._id, patch);
    const owner = await getOwnerPublisher(ctx, {
      ownerPublisherId: nextSkill.ownerPublisherId,
      ownerUserId: nextSkill.ownerUserId,
    });
    await upsertSkillSearchDigest(ctx, {
      ...(await extractValidatedDigestFields(ctx, nextSkill)),
      ownerHandle: owner?.handle ?? "",
      ownerKind: owner?.kind,
      ownerName: owner?.linkedUserId ? owner.handle : undefined,
      ownerDisplayName: owner?.displayName,
      ownerImage: owner?.image,
    });
  },
});

export const backfillPackageCatalogMetadata = migrations.define({
  table: "packages",
  batchSize: 50,
  migrateOne: async (ctx, pkg) => {
    const patch = buildPackageCatalogMetadataBackfillPatch(pkg);
    const nextPackage = { ...pkg, ...patch };
    if (Object.keys(patch).length) await ctx.db.patch(pkg._id, patch);
    const owner = await getOwnerPublisher(ctx, {
      ownerPublisherId: nextPackage.ownerPublisherId,
      ownerUserId: nextPackage.ownerUserId,
    });
    await upsertPackageSearchDigest(ctx, {
      ...extractPackageDigestFields(nextPackage),
      ownerHandle: owner?.handle ?? "",
      ownerKind: owner?.kind,
    });
  },
});

export const runCatalogMetadataBackfill = migrations.runner([
  internal.migrations.backfillSkillCatalogMetadata,
  internal.migrations.backfillPackageCatalogMetadata,
]);
