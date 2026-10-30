import { decodeUtf8Text } from "clawhub-schema/textFiles";
import type { Id } from "../_generated/dataModel";

export async function fetchText(
  ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } },
  storageId: Id<"_storage">,
) {
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new Error("File missing in storage");
  const text = decodeUtf8Text(new Uint8Array(await blob.arrayBuffer()));
  if (text === null) throw new Error("File is not valid UTF-8 text");
  return text;
}
