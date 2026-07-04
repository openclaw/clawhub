import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { mergeHeaders } from "../lib/httpHeaders";
import { applyRateLimit } from "../lib/httpRateLimit";
import {
  formatUserFacingErrorMessage,
  getPathSegments,
  json,
  parseJsonPayload,
  requireAdminOrResponse,
  requireApiTokenUserOrResponse,
  text,
} from "./shared";

// Active promotions change rarely and get hit by every CLI at runtime; let
// CDNs and clients cache briefly so launch spikes don't reach Convex.
const PROMOTIONS_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
} as const;

type PromotionModelPayload = {
  modelRef: string;
  alias?: string;
  suggestedDefault?: boolean;
};

type PromotionInputPayload = {
  slug: string;
  title: string;
  blurb: string;
  sponsor?: string;
  startsAt: number;
  endsAt: number;
  provider?: string;
  authChoiceId?: string;
  pluginNames?: string[];
  models: PromotionModelPayload[];
  signupUrl?: string;
  docsUrl?: string;
  launchPageUrl?: string;
};

function optionalString(value: unknown, label: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function requiredString(value: unknown, label: string) {
  const parsed = optionalString(value, label);
  if (!parsed) throw new Error(`Missing ${label}`);
  return parsed;
}

function requiredNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a timestamp (ms since epoch)`);
  }
  return value;
}

function parsePromotionInputPayload(payload: Record<string, unknown>): PromotionInputPayload {
  const modelsRaw = payload.models;
  if (!Array.isArray(modelsRaw) || modelsRaw.length === 0) {
    throw new Error("models must be a non-empty array");
  }
  const models = modelsRaw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`models[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const suggestedDefault = record.suggestedDefault;
    if (suggestedDefault !== undefined && typeof suggestedDefault !== "boolean") {
      throw new Error(`models[${index}].suggestedDefault must be a boolean`);
    }
    const alias = optionalString(record.alias, `models[${index}].alias`);
    return {
      modelRef: requiredString(record.modelRef, `models[${index}].modelRef`),
      ...(alias ? { alias } : {}),
      ...(suggestedDefault ? { suggestedDefault } : {}),
    };
  });

  let pluginNames: string[] | undefined;
  if (payload.pluginNames !== undefined && payload.pluginNames !== null) {
    if (!Array.isArray(payload.pluginNames)) {
      throw new Error("pluginNames must be an array of strings");
    }
    pluginNames = payload.pluginNames.map((name, index) =>
      requiredString(name, `pluginNames[${index}]`),
    );
  }

  const sponsor = optionalString(payload.sponsor, "sponsor");
  const provider = optionalString(payload.provider, "provider");
  const authChoiceId = optionalString(payload.authChoiceId, "authChoiceId");
  const signupUrl = optionalString(payload.signupUrl, "signupUrl");
  const docsUrl = optionalString(payload.docsUrl, "docsUrl");
  const launchPageUrl = optionalString(payload.launchPageUrl, "launchPageUrl");

  return {
    slug: requiredString(payload.slug, "slug"),
    title: requiredString(payload.title, "title"),
    blurb: requiredString(payload.blurb, "blurb"),
    ...(sponsor ? { sponsor } : {}),
    startsAt: requiredNumber(payload.startsAt, "startsAt"),
    endsAt: requiredNumber(payload.endsAt, "endsAt"),
    ...(provider ? { provider } : {}),
    ...(authChoiceId ? { authChoiceId } : {}),
    ...(pluginNames && pluginNames.length > 0 ? { pluginNames } : {}),
    models,
    ...(signupUrl ? { signupUrl } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(launchPageUrl ? { launchPageUrl } : {}),
  };
}

function writeErrorToResponse(error: unknown, headers: HeadersInit) {
  const message = formatUserFacingErrorMessage(error, "Promotion request failed");
  const lower = message.toLowerCase();
  if (lower.includes("unauthorized")) return text("Unauthorized", 401, headers);
  if (lower.includes("forbidden")) return text("Forbidden", 403, headers);
  if (lower.includes("not found")) return text(message, 404, headers);
  if (lower.includes("already exists")) return text(message, 409, headers);
  return text(message, 400, headers);
}

export async function listPromotionsV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const url = new URL(request.url);
  if (url.searchParams.get("status") === "all") {
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;
    const admin = requireAdminOrResponse(auth.user, rate.headers);
    if (!admin.ok) return admin.response;
    const promotions = await ctx.runQuery(internal.promotions.listAllInternal, {});
    return json({ promotions }, 200, rate.headers);
  }

  const promotions = await ctx.runQuery(internal.promotions.listActiveInternal, {
    now: Date.now(),
  });
  return json({ promotions }, 200, mergeHeaders(rate.headers, PROMOTIONS_CACHE_HEADERS));
}

export async function promotionsGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const segments = getPathSegments(request, "/api/v1/promotions/");
  if (segments.length !== 1) return text("Not found", 404, rate.headers);
  const slug = segments[0]?.trim().toLowerCase() ?? "";
  if (!slug) return text("Not found", 404, rate.headers);

  const promotion = await ctx.runQuery(internal.promotions.getBySlugPublicInternal, {
    slug,
    now: Date.now(),
  });
  if (!promotion) return text("Promotion not found", 404, rate.headers);
  return json(promotion, 200, mergeHeaders(rate.headers, PROMOTIONS_CACHE_HEADERS));
}

export async function createPromotionV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const admin = requireAdminOrResponse(auth.user, rate.headers);
  if (!admin.ok) return admin.response;

  const payloadResult = await parseJsonPayload(request, rate.headers);
  if (!payloadResult.ok) return payloadResult.response;

  try {
    const input = parsePromotionInputPayload(payloadResult.payload);
    const result = await ctx.runMutation(internal.promotions.createInternal, {
      actorUserId: auth.userId,
      input,
    });
    return json(result, 200, rate.headers);
  } catch (error) {
    return writeErrorToResponse(error, rate.headers);
  }
}

export async function promotionsPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const segments = getPathSegments(request, "/api/v1/promotions/");
  if (segments.length !== 2) return text("Not found", 404, rate.headers);
  const slug = segments[0]?.trim().toLowerCase() ?? "";
  const action = segments[1];
  if (!slug || (action !== "update" && action !== "status")) {
    return text("Not found", 404, rate.headers);
  }

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const admin = requireAdminOrResponse(auth.user, rate.headers);
  if (!admin.ok) return admin.response;

  const payloadResult = await parseJsonPayload(request, rate.headers);
  if (!payloadResult.ok) return payloadResult.response;
  const payload = payloadResult.payload;

  try {
    if (action === "status") {
      const status = typeof payload.status === "string" ? payload.status.trim() : "";
      if (status !== "draft" && status !== "active" && status !== "ended") {
        return text("status must be one of draft|active|ended", 400, rate.headers);
      }
      const result = await ctx.runMutation(internal.promotions.setStatusInternal, {
        actorUserId: auth.userId,
        slug,
        status,
      });
      return json(result, 200, rate.headers);
    }

    const input = parsePromotionInputPayload(payload);
    const result = await ctx.runMutation(internal.promotions.updateInternal, {
      actorUserId: auth.userId,
      targetSlug: slug,
      input,
    });
    return json(result, 200, rate.headers);
  } catch (error) {
    return writeErrorToResponse(error, rate.headers);
  }
}
