import {
  FeaturedEditorialSaveSchema,
  FeaturedSelectionPublishSchema,
  parseArk,
} from "clawhub-schema";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import {
  formatUserFacingErrorMessage,
  getPathSegments,
  json,
  parseJsonPayload,
  requireApiTokenUserOrResponse,
  requireModeratorOrResponse,
  text,
} from "./shared";

export async function featuredV1Handler(ctx: ActionCtx, request: Request): Promise<Response> {
  const rate = await applyRateLimit(ctx, request, request.method === "GET" ? "read" : "write");
  if (!rate.ok) return rate.response;
  const headers = new Headers(rate.headers);
  headers.set("Cache-Control", "private, no-store");
  const auth = await requireApiTokenUserOrResponse(ctx, request, headers);
  if (!auth.ok) return auth.response;
  const staff = requireModeratorOrResponse(auth.user, headers);
  if (!staff.ok) return staff.response;
  const [artifactKind, operation, extra] = getPathSegments(request, "/api/v1/featured/");
  if ((artifactKind !== "plugin" && artifactKind !== "skill") || extra)
    return text("Not found", 404, headers);
  if (request.method === "GET" && !operation) {
    const result = await ctx.runQuery(internal.featuredSelections.getForUserInternal, {
      actorUserId: auth.userId,
      artifactKind,
    });
    return json(result, 200, headers);
  }
  if (
    request.method !== "POST" ||
    (operation !== "publish" && !(operation === "editorial" && artifactKind === "plugin"))
  )
    return text("Not found", 404, headers);
  const payload = await parseJsonPayload(request, headers);
  if (!payload.ok) return payload.response;
  let input:
    | { operation: "editorial"; value: typeof FeaturedEditorialSaveSchema.infer }
    | { operation: "publish"; value: typeof FeaturedSelectionPublishSchema.infer };
  try {
    input =
      operation === "editorial"
        ? {
            operation,
            value: parseArk(FeaturedEditorialSaveSchema, payload.payload, "editorial selection"),
          }
        : {
            operation: "publish",
            value: parseArk(
              FeaturedSelectionPublishSchema,
              payload.payload,
              "Featured publication",
            ),
          };
  } catch (error) {
    return text(formatUserFacingErrorMessage(error, "Invalid Featured selection"), 400, headers);
  }
  try {
    const result =
      input.operation === "editorial"
        ? await ctx.runMutation(internal.featuredSelections.saveEditorialForUserInternal, {
            ...input.value,
            actorUserId: auth.userId,
          })
        : await ctx.runMutation(internal.featuredSelections.publishForUserInternal, {
            ...input.value,
            actorUserId: auth.userId,
            artifactKind,
          });
    return json(result, 200, headers);
  } catch (error) {
    if (
      !(error instanceof ConvexError) &&
      !/(?:Uncaught\s+)?ConvexError:/.test(error instanceof Error ? error.message : "")
    )
      return text("Internal Server Error", 500, headers);
    const message = formatUserFacingErrorMessage(error, "Featured selection failed");
    return text(message, /changed/i.test(message) ? 409 : 400, headers);
  }
}
