import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { getOptionalActiveAuthUserIdFromAction } from "../lib/access";
import { applyRateLimit } from "../lib/httpRateLimit";
import { json, text } from "./shared";

export async function verifyDocsSessionV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  try {
    const userId = await getOptionalActiveAuthUserIdFromAction(ctx);
    if (!userId) return text("Unauthorized", 401, rate.headers);
    const user = await ctx.runQuery(internal.users.getByIdInternal, { userId });
    if (!user || user.deletedAt || user.deactivatedAt) {
      return text("Unauthorized", 401, rate.headers);
    }
    return json(
      {
        provider: "github",
        user: {
          id: user._id,
          handle: user.handle ?? user.name ?? null,
          displayName: user.displayName ?? null,
          image: user.image ?? null,
        },
      },
      200,
      rate.headers,
    );
  } catch {
    return text("Unauthorized", 401, rate.headers);
  }
}
