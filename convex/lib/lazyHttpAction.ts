import type { PublicHttpAction } from "convex/server";
import { httpAction } from "../_generated/server";
import { getRegisteredHttpHandler } from "./httpRouteRateLimit";

/** Keep unrelated route implementations out of the HTTP startup graph. */
export function lazyHttpAction(load: () => Promise<PublicHttpAction>): PublicHttpAction {
  return httpAction(async (ctx, request) => {
    const action = await load();
    return await getRegisteredHttpHandler(action)(ctx, request);
  });
}
