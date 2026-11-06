import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { sha256Hex } from "./clawpack";
import type { normalizePublishFiles } from "./packageRegistry";

const FILE_VERIFICATION_BATCH_SIZE = 16;

export async function verifyPublishFileStorageMetadata(
  ctx: Pick<ActionCtx, "storage">,
  files: ReturnType<typeof normalizePublishFiles>,
) {
  const verifyFile = async (file: (typeof files)[number]) => {
    const blob = await ctx.storage.get(file.storageId as Id<"_storage">);
    if (!blob) throw new ConvexError(`Uploaded file no longer exists: ${file.path}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      file: {
        ...file,
        size: blob.size,
        sha256: await sha256Hex(bytes),
        contentType: file.contentType?.trim() || blob.type || undefined,
      },
      zipEntry: { path: file.path, bytes },
    };
  };
  const verified: Array<Awaited<ReturnType<typeof verifyFile>>> = [];
  for (let offset = 0; offset < files.length; offset += FILE_VERIFICATION_BATCH_SIZE) {
    // Bound reads through hashing, and drain started peers before failure cleanup.
    const results = await Promise.allSettled(
      files.slice(offset, offset + FILE_VERIFICATION_BATCH_SIZE).map(verifyFile),
    );
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      verified.push(result.value);
    }
  }
  return {
    files: verified.map(({ file }) => file),
    legacyZipEntries: verified.map(({ zipEntry }) => zipEntry),
  };
}
