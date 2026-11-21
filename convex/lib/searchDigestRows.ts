import type { WithoutSystemFields } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type FacetTable =
  | "packagePluginCategorySearchDigest"
  | "packageTopicSearchDigest"
  | "skillTopicSearchDigest";

export function hasDigestChanged(
  existing: Record<string, unknown>,
  fields: Record<string, unknown>,
): boolean {
  for (const key of Object.keys(fields)) {
    const oldValue = existing[key];
    const newValue = fields[key];
    if (oldValue === newValue) continue;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) return true;
  }
  return false;
}

export async function reconcileSearchDigestRows<Table extends FacetTable>(
  db: Pick<MutationCtx["db"], "insert" | "patch" | "delete">,
  table: Table,
  existing: Doc<Table>[],
  nextByKey: Map<string, WithoutSystemFields<Doc<Table>>>,
  getKey: (row: Doc<Table>) => string,
) {
  for (const row of existing) {
    const next = nextByKey.get(getKey(row));
    if (!next) {
      await db.delete(row._id);
      continue;
    }
    if (hasDigestChanged(row, next)) await db.patch(row._id, next);
    nextByKey.delete(getKey(row));
  }
  for (const next of nextByKey.values()) await db.insert(table, next);
}
