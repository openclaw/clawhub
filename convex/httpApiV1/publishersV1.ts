import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import { json, parseJsonPayload, requireApiTokenUserOrResponse, text } from "./shared";

const publisherInternalRefs = internal as unknown as {
  publishers: {
    createOrgPublisherForUserInternal: unknown;
  };
};

export async function createPublisherV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const payloadResult = await parseJsonPayload(request, rate.headers);
  if (!payloadResult.ok) return payloadResult.response;
  const payload = payloadResult.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return text("JSON body must be an object", 400, rate.headers);
  }

  const authResult = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!authResult.ok) return authResult.response;

  const handle = typeof payload.handle === "string" ? payload.handle.trim().toLowerCase() : "";
  if (!handle) return text("Missing handle", 400, rate.headers);
  const displayName =
    typeof payload.displayName === "string" ? payload.displayName.trim() || undefined : undefined;

  try {
    const result = await ctx.runMutation(
      publisherInternalRefs.publishers.createOrgPublisherForUserInternal as never,
      {
        actorUserId: authResult.userId,
        handle,
        ...(displayName ? { displayName } : {}),
      } as never,
    );
    return json(result, 201, rate.headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publisher create failed";
    if (/already exists|already used/i.test(message)) return text(message, 409, rate.headers);
    if (/unauthorized/i.test(message)) return text("Unauthorized", 401, rate.headers);
    return text(message, 400, rate.headers);
  }
}
