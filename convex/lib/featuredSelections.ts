import { ConvexError, v, type Infer } from "convex/values";

export const FEATURED_EDITORIAL_SLOTS = 8;
export const editorialSelection = v.object({
  id: v.string(),
  name: v.string(),
  displayName: v.string(),
  reason: v.string(),
});
export type EditorialSelection = Infer<typeof editorialSelection>;
export const publishedSelection = v.object({
  id: v.string(),
  version: v.string(),
  selectionBasis: v.union(v.literal("editorial"), v.literal("telemetry")),
  reason: v.string(),
  installs30d: v.optional(v.number()),
  installs7d: v.optional(v.number()),
});
export const featuredPublication = v.object({
  reportId: v.string(),
  reportHash: v.string(),
  items: v.array(publishedSelection),
  periodStart: v.number(),
  periodEnd: v.number(),
  at: v.number(),
  byUserId: v.id("users"),
});

export function validateEditorial(items: EditorialSelection[]) {
  if (items.length > FEATURED_EDITORIAL_SLOTS)
    throw new ConvexError("At most eight editorial reservations are allowed.");
  const identities = new Set<string>();
  for (const item of items) {
    if (
      !item.name ||
      item.name.length > 200 ||
      item.name !== item.name.trim().toLowerCase() ||
      item.id !== `plugin:${item.name}` ||
      identities.has(item.id) ||
      !item.displayName.trim() ||
      item.displayName.length > 120 ||
      !item.reason.trim() ||
      item.reason.length > 500
    )
      throw new ConvexError(
        "Editorial selections need unique plugin identities, names and bounded reasons.",
      );
    identities.add(item.id);
  }
}
