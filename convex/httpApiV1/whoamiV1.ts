import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import { json, requireApiTokenUserOrResponse } from "./shared";

export async function whoamiV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const { user } = auth;
  return json(
    {
      user: {
        handle: user.handle ?? null,
        displayName: user.displayName ?? null,
        image: user.image ?? null,
        role: user.role ?? null,
      },
    },
    200,
    rate.headers,
  );
}
