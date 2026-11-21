import { decodeUtf8Text } from "clawhub-schema/textFiles";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

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
  if (text === null) throw new ConvexError("File is not valid UTF-8 text");
  return text;
}

export async function readStorageText(
  ctx: Pick<ActionCtx, "storage">,
  storageId: string,
  options: { maxBytes?: number; label?: string; strictUtf8?: boolean } = {},
): Promise<string> {
  const blob = await ctx.storage.get(storageId as never);
  if (!blob) throw new ConvexError("Uploaded file no longer exists");
  if (options.maxBytes !== undefined && blob.size > options.maxBytes) {
    throw new ConvexError(`${options.label ?? "Uploaded text file"} exceeds byte limit`);
  }
  if (!options.strictUtf8) return await blob.text();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer());
  } catch {
    throw new ConvexError(`${options.label ?? "Uploaded text file"} must be valid UTF-8`);
  }
}

export async function readOptionalTextFile<TFile extends { path: string; storageId: string }>(
  ctx: Pick<ActionCtx, "storage">,
  files: TFile[],
  pathMatch: (path: string) => boolean,
  options: {
    exactPath?: boolean;
    maxBytes?: number;
    label?: string;
    strictUtf8?: boolean;
  } = {},
) {
  const file = files.find((entry) =>
    pathMatch(options.exactPath ? entry.path : entry.path.toLowerCase()),
  );
  if (!file) return null;
  return {
    file,
    text: await readStorageText(ctx, file.storageId, options),
  };
}
