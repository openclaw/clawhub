import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function insertPackageInstallStatEvent(
  ctx: Pick<MutationCtx, "db">,
  params: {
    packageId: Id<"packages">;
    kind?: "install" | "install_clear";
    occurredAt?: number;
  },
) {
  await ctx.db.insert("packageStatEvents", {
    packageId: params.packageId,
    kind: params.kind ?? "install",
    occurredAt: params.occurredAt ?? Date.now(),
    processedAt: undefined,
  });
}
