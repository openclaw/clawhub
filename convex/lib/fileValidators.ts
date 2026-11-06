import { v } from "convex/values";

export const storedFileValidator = v.object({
  path: v.string(),
  size: v.number(),
  storageId: v.id("_storage"),
  sha256: v.string(),
  contentType: v.optional(v.string()),
});

export const storedFilesValidator = v.array(storedFileValidator);
