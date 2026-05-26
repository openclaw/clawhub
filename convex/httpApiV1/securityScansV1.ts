import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { assertModerator } from "../lib/access";
import { applyRateLimit } from "../lib/httpRateLimit";
import {
  CLAW_SCAN_DIGEST_VERDICTS,
  SECURITY_SCAN_FAILURE_STATUSES,
  SECURITY_SCAN_PIPELINE_STATUSES,
} from "../lib/securityScanDigest";
import {
  getPathSegments,
  json,
  requireApiTokenUserOrResponse,
  text,
  toOptionalNumber,
} from "./shared";

const securityScanInternalRefs = internal as unknown as {
  securityScanDigests: {
    getStaffSecurityScanOverviewInternal: unknown;
    listStaffSecurityScanArtifactsInternal: unknown;
    getStaffSecurityScanArtifactInternal: unknown;
  };
};

async function runSecurityScanQueryRef<T>(
  ctx: Pick<ActionCtx, "runQuery">,
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

function requireModeratorOrResponse(user: Doc<"users">, headers: HeadersInit) {
  try {
    assertModerator(user);
    return { ok: true as const };
  } catch {
    return { ok: false as const, response: text("Moderator role required.", 403, headers) };
  }
}

function toOptionalArtifactKind(value: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "skill" || normalized === "plugin") return normalized;
  return null;
}

function toOptionalClawScanVerdict(value: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return CLAW_SCAN_DIGEST_VERDICTS.includes(normalized as never) ? normalized : null;
}

function toOptionalScanJobStatus(value: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return SECURITY_SCAN_PIPELINE_STATUSES.includes(normalized as never) ? normalized : null;
}

function toOptionalFailureStatus(value: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return SECURITY_SCAN_FAILURE_STATUSES.includes(normalized as never) ? normalized : null;
}

function normalizeOptionalString(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function mapSecurityScanReadError(error: unknown, headers: HeadersInit) {
  const message = error instanceof Error ? error.message : "Security scan read failed";
  const lower = message.toLowerCase();
  if (lower.includes("forbidden") || lower.includes("moderator")) {
    return text("Forbidden", 403, headers);
  }
  if (lower.includes("not found")) {
    return text(message, 404, headers);
  }
  return text(message, 400, headers);
}

export async function securityScansGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const segments = getPathSegments(request, "/api/v1/security-scans/");
  if (segments.length !== 1) return text("Not found", 404, rate.headers);

  const action = segments[0];
  if (action !== "overview" && action !== "artifacts" && action !== "artifact") {
    return text("Not found", 404, rate.headers);
  }

  const authResult = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!authResult.ok) return authResult.response;
  const moderator = requireModeratorOrResponse(authResult.user, rate.headers);
  if (!moderator.ok) return moderator.response;

  const params = new URL(request.url).searchParams;
  const actorUserId = authResult.userId as Id<"users">;

  try {
    if (action === "overview") {
      const artifactKind = toOptionalArtifactKind(params.get("artifactKind"));
      if (artifactKind === null) return text("Invalid artifactKind", 400, rate.headers);
      const result = await runSecurityScanQueryRef(
        ctx,
        securityScanInternalRefs.securityScanDigests.getStaffSecurityScanOverviewInternal,
        {
          actorUserId,
          artifactKind,
          windowHours: toOptionalNumber(params.get("windowHours")),
          failedLimit: toOptionalNumber(params.get("failedLimit")),
        },
      );
      return json(result, 200, rate.headers);
    }

    if (action === "artifacts") {
      const artifactKind = toOptionalArtifactKind(params.get("artifactKind"));
      if (artifactKind === undefined) return text("Missing artifactKind", 400, rate.headers);
      if (artifactKind === null) return text("Invalid artifactKind", 400, rate.headers);

      const clawScanVerdict = toOptionalClawScanVerdict(params.get("clawScanVerdict"));
      if (clawScanVerdict === null) return text("Invalid clawScanVerdict", 400, rate.headers);
      const scanJobStatus = toOptionalScanJobStatus(params.get("scanJobStatus"));
      if (scanJobStatus === null) return text("Invalid scanJobStatus", 400, rate.headers);
      const failureStatus = toOptionalFailureStatus(params.get("failureStatus"));
      if (failureStatus === null) return text("Invalid failureStatus", 400, rate.headers);

      const result = await runSecurityScanQueryRef(
        ctx,
        securityScanInternalRefs.securityScanDigests.listStaffSecurityScanArtifactsInternal,
        {
          actorUserId,
          artifactKind,
          cursor: normalizeOptionalString(params.get("cursor")) ?? null,
          limit: toOptionalNumber(params.get("limit")),
          clawScanVerdict,
          scanJobStatus,
          failureStatus,
          clawScanPrimaryCategoryKey: normalizeOptionalString(
            params.get("clawScanPrimaryCategoryKey"),
          ),
        },
      );
      return json(result, 200, rate.headers);
    }

    const result = await runSecurityScanQueryRef(
      ctx,
      securityScanInternalRefs.securityScanDigests.getStaffSecurityScanArtifactInternal,
      {
        actorUserId,
        skillSlug: normalizeOptionalString(params.get("skillSlug")),
        packageName: normalizeOptionalString(params.get("packageName")),
      },
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    return mapSecurityScanReadError(error, rate.headers);
  }
}
