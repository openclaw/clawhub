"use node";

import { parseArk, PackagePublishMetadataSchema } from "clawhub-schema";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { parseClawPack } from "./lib/clawpack";
import {
  assertClawPackPublicationIdentity,
  buildPackagePublishRequestFromClawPack,
  readStoredPackageTarball,
} from "./lib/packageClawpackPublish";

export const prepareClawPackInternal = internalAction({
  args: {
    artifactStorageId: v.id("_storage"),
    metadataJson: v.string(),
  },
  returns: v.object({
    payloadJson: v.string(),
    requestStorageIds: v.array(v.id("_storage")),
  }),
  handler: async (ctx, { artifactStorageId, metadataJson }) => {
    const requestStorageIds = new Set<Id<"_storage">>();
    try {
      const metadata = parseArk(
        PackagePublishMetadataSchema,
        JSON.parse(metadataJson),
        "Package publish payload",
      );
      const bytes = await readStoredPackageTarball(ctx, artifactStorageId);
      const parsed = await parseClawPack(bytes);
      assertClawPackPublicationIdentity(metadata, parsed);
      const payload = await buildPackagePublishRequestFromClawPack(
        ctx,
        metadata,
        parsed,
        bytes,
        artifactStorageId,
        requestStorageIds,
      );
      return { payloadJson: JSON.stringify(payload), requestStorageIds: [...requestStorageIds] };
    } catch (error) {
      // The original staged archive remains available; only extracted blobs are ours.
      await Promise.allSettled([...requestStorageIds].map((id) => ctx.storage.delete(id)));
      throw error;
    }
  },
});
