import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import { getPathSegments, json, requireApiTokenUserOrResponse, text } from "./shared";

export async function starsPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const segments = getPathSegments(request, "/api/v1/stars/");
  if (segments.length !== 1) return text("Not found", 404, rate.headers);
  const slug = segments[0]?.trim().toLowerCase() ?? "";

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  try {
    const skill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug });
    if (!skill) return text("Skill not found", 404, rate.headers);

    const result = await ctx.runMutation(internal.stars.addStarInternal, {
      userId: auth.userId,
      skillId: skill._id,
    });
    return json(result, 200, rate.headers);
  } catch (e) {
    if (e instanceof Error && e.message === "Skill not found") {
      return text("Skill not found", 404, rate.headers);
    }
    return text(errorMessage(e, "Unable to star skill."), 400, rate.headers);
  }
}

export async function starsDeleteRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const segments = getPathSegments(request, "/api/v1/stars/");
  if (segments.length !== 1) return text("Not found", 404, rate.headers);
  const slug = segments[0]?.trim().toLowerCase() ?? "";

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  try {
    const skill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug });
    if (!skill) return text("Skill not found", 404, rate.headers);

    const result = await ctx.runMutation(internal.stars.removeStarInternal, {
      userId: auth.userId,
      skillId: skill._id,
    });
    return json(result, 200, rate.headers);
  } catch (error) {
    return text(errorMessage(error, "Unable to unstar skill."), 400, rate.headers);
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}
