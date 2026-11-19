import { decodeUtf8Text } from "clawhub-schema/textFiles";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";

export const MAX_RAW_FILE_BYTES = 200 * 1024;

/** Bounded file lookup shared by package /file and the inline Template preview. */
export async function readBoundedPackageBlob(
  ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } },
  file: { storageId: Id<"_storage">; size: number },
  maxBytes: number,
) {
  if (file.size > maxBytes) return { status: 413, message: "File too large" } as const;
  const blob = await ctx.storage.get(file.storageId);
  if (!blob) return { status: 404, message: "File not found" } as const;
  return { status: 200, blob } as const;
}

export async function fetchText(
  ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } },
  storageId: Id<"_storage">,
) {
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new ConvexError("File missing in storage");
  const text = decodeUtf8Text(new Uint8Array(await blob.arrayBuffer()));
  if (text === null) throw new Error("File is not valid UTF-8 text");
  return text;
}
