import { makeFunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import {
  parseSubmissionRecoveryRequest,
  type SubmissionRecoveryRequest,
} from "../lib/packageSubmissionRecovery";
import type { SubmissionRecoveryResult } from "../packageSubmissionRecovery";
import {
  json,
  text,
  formatUserFacingErrorMessage,
  requireApiTokenUserOrResponse,
  transientConvexErrorResponse,
} from "./shared";

const recoverRef = makeFunctionReference<
  "action",
  { request: SubmissionRecoveryRequest; actorUserId: Id<"users">; apiTokenId: Id<"apiTokens"> },
  SubmissionRecoveryResult
>("packageSubmissionRecovery:recoverInternal");
export async function recoverPackageSubmissionV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  let body: SubmissionRecoveryRequest;
  try {
    body = parseSubmissionRecoveryRequest(await request.json());
  } catch (error) {
    return text(
      formatUserFacingErrorMessage(error, "Submission recovery request failed"),
      400,
      rate.headers,
    );
  }
  try {
    const result = await ctx.runAction(recoverRef, {
      request: body,
      actorUserId: auth.userId,
      apiTokenId: auth.apiTokenId,
    });
    return json(result, result.reused ? 200 : 202, rate.headers);
  } catch (error) {
    const transient = transientConvexErrorResponse(error, rate.headers, { outcomeUnknown: true });
    if (transient) return transient;
    const message = formatUserFacingErrorMessage(error, "Submission recovery failed");
    return text(message, message.includes("not found") ? 404 : 409, rate.headers);
  }
}
