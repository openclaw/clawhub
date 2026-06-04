import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { assertAdmin, requireUser } from "./lib/access";
import { getPublisherByHandle } from "./lib/publishers";

const DEFAULT_OFFICIAL_PUBLISHER_HANDLES = ["openclaw", "nvidia"] as const;
const DEFAULT_OFFICIAL_PUBLISHER_REASON = "default-official-publisher-migration";

export async function seedDefaultOfficialPublishersHandler(
  ctx: MutationCtx,
  args: { actorUserId?: Id<"users">; now?: number } = {},
) {
  const now = args.now ?? Date.now();
  const missing: string[] = [];
  let seeded = 0;
  let alreadyOfficial = 0;

  for (const handle of DEFAULT_OFFICIAL_PUBLISHER_HANDLES) {
    const publisher = await getPublisherByHandle(ctx, handle);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      missing.push(handle);
      continue;
    }

    const existing = await ctx.db
      .query("officialPublishers")
      .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
      .unique();
    if (existing) {
      alreadyOfficial++;
      continue;
    }

    await ctx.db.insert("officialPublishers", {
      publisherId: publisher._id,
      reason: DEFAULT_OFFICIAL_PUBLISHER_REASON,
      createdByUserId: args.actorUserId,
      createdAt: now,
      updatedAt: now,
    });
    seeded++;
  }

  return {
    ok: true as const,
    seeded,
    alreadyOfficial,
    missing,
  };
}

export const seedDefaultOfficialPublishers: ReturnType<typeof mutation> = mutation({
  args: {},
  handler: async (ctx) => {
    const { user, userId } = await requireUser(ctx);
    assertAdmin(user);
    return await seedDefaultOfficialPublishersHandler(ctx, { actorUserId: userId });
  },
});
