import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import {
  getPathSegments,
  json,
  parseJsonPayload,
  requireAdminOrResponse,
  requireApiTokenUserOrResponse,
  text,
  toOptionalNumber,
} from "./shared";

const usersV1InternalRefs = internal as unknown as {
  publishers: {
    removeOrgPublisherMemberInternal: unknown;
  };
  users: {
    getBanAppealContextByGitHubProviderAccountIdInternal: unknown;
    getByHandleInternal: unknown;
    remediateAutobansInternal: unknown;
    reclassifyBanInternal: unknown;
    unbanUserForBanAppealServiceInternal: unknown;
  };
};

async function runUsersV1QueryRef<T>(
  ctx: Pick<ActionCtx, "runQuery">,
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runUsersV1MutationRef<T>(
  ctx: Pick<ActionCtx, "runMutation">,
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

function getBanAppealsServiceToken() {
  return process.env.CLAWHUB_BAN_APPEALS_TOKEN?.trim() || "";
}

function readBearerToken(request: Request) {
  return (
    request.headers
      .get("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() ?? ""
  );
}

function requireBanAppealsServiceOrResponse(request: Request, headers: HeadersInit) {
  const expected = getBanAppealsServiceToken();
  if (!expected)
    return { ok: false as const, response: text("Ban appeals service unavailable", 503, headers) };
  if (readBearerToken(request) !== expected) {
    return { ok: false as const, response: text("Unauthorized", 401, headers) };
  }
  return { ok: true as const };
}

export async function usersPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const segments = getPathSegments(request, "/api/v1/users/");
  if (segments.length !== 1) {
    return text("Not found", 404, rate.headers);
  }
  const action = segments[0];
  if (
    action !== "ban" &&
    action !== "unban" &&
    action !== "role" &&
    action !== "restore" &&
    action !== "remediate-autobans" &&
    action !== "reclassify-ban" &&
    action !== "ban-appeal-unban" &&
    action !== "reclaim" &&
    action !== "reserve" &&
    action !== "publisher" &&
    action !== "publisher-member"
  ) {
    return text("Not found", 404, rate.headers);
  }

  const payloadResult = await parseJsonPayload(request, rate.headers);
  if (!payloadResult.ok) return payloadResult.response;
  const payload = payloadResult.payload;

  if (action === "ban-appeal-unban") {
    return handleBanAppealUnban(ctx, request, payload, rate.headers);
  }

  const authResult = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!authResult.ok) return authResult.response;
  const actorUserId = authResult.userId;
  const actorUser = authResult.user;

  // Restore and reclaim have different parameter shapes, handle them separately
  if (action === "restore") {
    const admin = requireAdminOrResponse(actorUser, rate.headers);
    if (!admin.ok) return admin.response;
    return handleAdminRestore(ctx, request, payload, actorUserId, rate.headers);
  }

  if (action === "remediate-autobans") {
    const admin = requireAdminOrResponse(actorUser, rate.headers);
    if (!admin.ok) return admin.response;
    return handleAdminRemediateAutobans(ctx, payload, actorUserId, rate.headers);
  }

  if (action === "reclassify-ban") {
    const admin = requireAdminOrResponse(actorUser, rate.headers);
    if (!admin.ok) return admin.response;
    return handleAdminReclassifyBan(ctx, payload, actorUserId, rate.headers);
  }

  if (action === "reclaim") {
    const admin = requireAdminOrResponse(actorUser, rate.headers);
    if (!admin.ok) return admin.response;
    return handleAdminReclaim(ctx, request, payload, actorUserId, rate.headers);
  }

  if (action === "reserve") {
    const admin = requireAdminOrResponse(actorUser, rate.headers);
    if (!admin.ok) return admin.response;
    return handleAdminReserve(ctx, payload, actorUserId, rate.headers);
  }

  if (action === "publisher") {
    const admin = requireAdminOrResponse(actorUser, rate.headers);
    if (!admin.ok) return admin.response;
    return handleAdminEnsurePublisher(ctx, payload, actorUserId, rate.headers);
  }

  if (action === "publisher-member") {
    const admin = requireAdminOrResponse(actorUser, rate.headers);
    if (!admin.ok) return admin.response;
    return handleAdminRemovePublisherMember(ctx, payload, actorUserId, rate.headers);
  }

  const handleRaw = typeof payload.handle === "string" ? payload.handle.trim() : "";
  const userIdRaw = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const reasonRaw = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (!handleRaw && !userIdRaw) {
    return text("Missing userId or handle", 400, rate.headers);
  }

  const roleRaw = typeof payload.role === "string" ? payload.role.trim().toLowerCase() : "";
  if (action === "role" && !roleRaw) {
    return text("Missing role", 400, rate.headers);
  }
  const role =
    roleRaw === "user" || roleRaw === "moderator" || roleRaw === "admin" ? roleRaw : null;
  if (action === "role" && !role) {
    return text("Invalid role", 400, rate.headers);
  }

  let targetUserId: Id<"users"> | null = userIdRaw ? (userIdRaw as Id<"users">) : null;
  if (!targetUserId) {
    const handle = handleRaw.toLowerCase();
    const user = await ctx.runQuery(api.users.getByHandle, { handle });
    if (!user?._id) return text("User not found", 404, rate.headers);
    targetUserId = user._id;
  }

  if (action === "ban") {
    const reason = reasonRaw.length > 0 ? reasonRaw : undefined;
    if (reason && reason.length > 500) {
      return text("Reason too long (max 500 chars)", 400, rate.headers);
    }
    try {
      const result = await ctx.runMutation(internal.users.banUserInternal, {
        actorUserId,
        targetUserId,
        reason,
      });
      return json(result, 200, rate.headers);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ban failed";
      if (message.toLowerCase().includes("forbidden")) {
        return text("Forbidden", 403, rate.headers);
      }
      if (message.toLowerCase().includes("not found")) {
        return text(message, 404, rate.headers);
      }
      return text(message, 400, rate.headers);
    }
  }

  if (action === "unban") {
    const reason = reasonRaw.length > 0 ? reasonRaw : undefined;
    if (reason && reason.length > 500) {
      return text("Reason too long (max 500 chars)", 400, rate.headers);
    }
    try {
      const result = await ctx.runMutation(internal.users.unbanUserInternal, {
        actorUserId,
        targetUserId,
        reason,
      });
      return json(result, 200, rate.headers);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unban failed";
      if (message.toLowerCase().includes("forbidden")) {
        return text("Forbidden", 403, rate.headers);
      }
      if (message.toLowerCase().includes("not found")) {
        return text(message, 404, rate.headers);
      }
      return text(message, 400, rate.headers);
    }
  }

  if (!role) {
    return text("Invalid role", 400, rate.headers);
  }

  try {
    const result = await ctx.runMutation(internal.users.setRoleInternal, {
      actorUserId,
      targetUserId,
      role,
    });
    return json({ ok: true, role: result.role ?? role }, 200, rate.headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Role change failed";
    if (message.toLowerCase().includes("forbidden")) {
      return text("Forbidden", 403, rate.headers);
    }
    if (message.toLowerCase().includes("not found")) {
      return text(message, 404, rate.headers);
    }
    return text(message, 400, rate.headers);
  }
}

async function handleAdminReclassifyBan(
  ctx: ActionCtx,
  payload: unknown,
  actorUserId: Id<"users">,
  headers: HeadersInit,
) {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const handle = typeof body.handle === "string" ? body.handle.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const dryRun = body.dryRun !== false;

  if (handle && userId) return text("Pass handle or userId, not both", 400, headers);
  if (!handle && !userId) return text("Missing userId or handle", 400, headers);
  if (!reason) return text("Missing reason", 400, headers);
  if (reason.length > 500) return text("Reason too long (max 500 chars)", 400, headers);

  let targetUserId: Id<"users"> | null = userId ? (userId as Id<"users">) : null;
  if (!targetUserId) {
    const user = await runUsersV1QueryRef<{ _id?: Id<"users"> } | null>(
      ctx,
      usersV1InternalRefs.users.getByHandleInternal,
      { handle: handle.toLowerCase() },
    );
    if (!user?._id) return text("User not found", 404, headers);
    targetUserId = user._id;
  }

  try {
    const result = await runUsersV1MutationRef(
      ctx,
      usersV1InternalRefs.users.reclassifyBanInternal,
      {
        actorUserId,
        targetUserId,
        reason,
        dryRun,
      },
    );
    return json(result, 200, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ban reclassification failed";
    if (message.toLowerCase().includes("forbidden")) {
      return text("Forbidden", 403, headers);
    }
    if (message.toLowerCase().includes("not found")) {
      return text(message, 404, headers);
    }
    return text(message, 400, headers);
  }
}

async function handleAdminRemediateAutobans(
  ctx: ActionCtx,
  payload: unknown,
  actorUserId: Id<"users">,
  headers: HeadersInit,
) {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const handle = typeof body.handle === "string" ? body.handle.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const since = typeof body.since === "string" ? body.since.trim() : "";
  const cursor = typeof body.cursor === "string" ? body.cursor.trim() : "";
  const dryRun = body.dryRun !== false;
  const limit =
    typeof body.limit === "number"
      ? body.limit
      : typeof body.limit === "string" || body.limit === null
        ? toOptionalNumber(body.limit)
        : undefined;

  if (handle && userId) return text("Pass handle or userId, not both", 400, headers);
  if (reason && reason.length > 500) {
    return text("Reason too long (max 500 chars)", 400, headers);
  }
  if (since && Number.isNaN(Date.parse(since))) {
    return text("Invalid since date", 400, headers);
  }
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    return text("Invalid limit", 400, headers);
  }

  try {
    const result = await runUsersV1MutationRef(
      ctx,
      usersV1InternalRefs.users.remediateAutobansInternal,
      {
        actorUserId,
        ...(userId ? { targetUserId: userId as Id<"users"> } : {}),
        ...(handle ? { handle } : {}),
        dryRun,
        ...(reason ? { reason } : {}),
        ...(since ? { since } : {}),
        ...(cursor ? { cursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
      },
    );
    return json(result, 200, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Autoban remediation failed";
    if (message.toLowerCase().includes("forbidden")) {
      return text("Forbidden", 403, headers);
    }
    if (message.toLowerCase().includes("not found")) {
      return text(message, 404, headers);
    }
    return text(message, 400, headers);
  }
}

/**
 * POST /api/v1/users/restore
 * Admin-only: restore skills from GitHub backup for a user.
 * Body: { handle: string, slugs: string[], forceOverwriteSquatter?: boolean }
 */
async function handleAdminRestore(
  ctx: ActionCtx,
  _request: Request,
  payload: Record<string, unknown>,
  actorUserId: Id<"users">,
  headers: HeadersInit,
) {
  const handle = typeof payload.handle === "string" ? payload.handle.trim().toLowerCase() : "";
  if (!handle) return text("Missing handle", 400, headers);

  const slugs = Array.isArray(payload.slugs)
    ? payload.slugs.filter((s): s is string => typeof s === "string")
    : [];
  if (slugs.length === 0) return text("Missing slugs array", 400, headers);
  if (slugs.length > 100) return text("Too many slugs (max 100)", 400, headers);

  const forceOverwriteSquatter = Boolean(payload.forceOverwriteSquatter);

  const targetUser = await ctx.runQuery(api.users.getByHandle, { handle });
  if (!targetUser?._id) return text("User not found", 404, headers);

  try {
    const result = await ctx.runAction(internal.githubRestore.restoreUserSkillsFromBackup, {
      actorUserId,
      ownerHandle: handle,
      ownerUserId: targetUser._id,
      slugs,
      forceOverwriteSquatter,
    });
    return json(result, 200, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore failed";
    if (message.toLowerCase().includes("forbidden")) {
      return text("Forbidden", 403, headers);
    }
    return text(message, 400, headers);
  }
}

/**
 * POST /api/v1/users/reclaim
 * Admin-only: reclaim root slugs for the rightful owner.
 * Default behavior is non-destructive owner transfer for existing skills
 * (preserves versions/stats/metadata) and leaves missing slugs untouched.
 * Body: { handle: string, slugs: string[], reason?: string }
 */
async function handleAdminReclaim(
  ctx: ActionCtx,
  _request: Request,
  payload: Record<string, unknown>,
  actorUserId: Id<"users">,
  headers: HeadersInit,
) {
  const handle = typeof payload.handle === "string" ? payload.handle.trim().toLowerCase() : "";
  if (!handle) return text("Missing handle", 400, headers);

  const slugs = Array.isArray(payload.slugs)
    ? payload.slugs.filter((s): s is string => typeof s === "string")
    : [];
  if (slugs.length === 0) return text("Missing slugs array", 400, headers);
  if (slugs.length > 200) return text("Too many slugs (max 200)", 400, headers);

  const reason = typeof payload.reason === "string" ? payload.reason.trim() : undefined;

  const targetUser = await ctx.runQuery(api.users.getByHandle, { handle });
  if (!targetUser?._id) return text("User not found", 404, headers);

  const results: Array<{ slug: string; ok: boolean; action?: string; error?: string }> = [];
  for (const slug of slugs) {
    try {
      const result = (await ctx.runMutation(internal.skills.reclaimSlugInternal, {
        actorUserId,
        slug: slug.trim().toLowerCase(),
        rightfulOwnerUserId: targetUser._id,
        reason,
        transferRootSlugOnly: true,
      })) as { action?: string };
      results.push({ slug, ok: true, action: result.action });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reclaim failed";
      results.push({ slug, ok: false, error: message });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return json({ ok: true, results, succeeded, failed }, 200, headers);
}

/**
 * POST /api/v1/users/reserve
 * Admin-only: reserve root slugs and package names for a rightful owner.
 * Package reservations are private placeholder packages with no releases.
 * Body: { handle: string, slugs?: string[], packageNames?: string[], reason?: string }
 */
async function handleAdminReserve(
  ctx: ActionCtx,
  payload: Record<string, unknown>,
  actorUserId: Id<"users">,
  headers: HeadersInit,
) {
  const handle = typeof payload.handle === "string" ? payload.handle.trim().toLowerCase() : "";
  if (!handle) return text("Missing handle", 400, headers);

  const slugs = Array.isArray(payload.slugs)
    ? payload.slugs.filter((s): s is string => typeof s === "string")
    : [];
  const packageNames = Array.isArray(payload.packageNames)
    ? payload.packageNames.filter((s): s is string => typeof s === "string")
    : [];
  const total = slugs.length + packageNames.length;
  if (total === 0) return text("Missing slugs or packageNames array", 400, headers);
  if (total > 200) return text("Too many reservations (max 200)", 400, headers);

  const reason = typeof payload.reason === "string" ? payload.reason.trim() : undefined;

  const targetUser = await ctx.runQuery(api.users.getByHandle, { handle });
  if (!targetUser?._id) return text("User not found", 404, headers);

  const targetPublisher = (await ctx.runQuery(internal.publishers.getByHandleInternal, {
    handle,
  })) as { _id?: Id<"publishers">; deletedAt?: number; deactivatedAt?: number } | null;
  const ownerPublisherId =
    targetPublisher?._id && !targetPublisher.deletedAt && !targetPublisher.deactivatedAt
      ? targetPublisher._id
      : undefined;

  const results: Array<{
    kind: "slug" | "package";
    name: string;
    ok: boolean;
    action?: string;
    error?: string;
  }> = [];

  for (const slug of slugs) {
    const name = slug.trim().toLowerCase();
    try {
      const result = (await ctx.runMutation(internal.skills.reserveSlugInternal, {
        actorUserId,
        slug: name,
        rightfulOwnerUserId: targetUser._id,
        reason,
      })) as { action?: string };
      results.push({ kind: "slug", name, ok: true, action: result.action });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slug reservation failed";
      results.push({ kind: "slug", name, ok: false, error: message });
    }
  }

  for (const packageName of packageNames) {
    const name = packageName.trim();
    try {
      const result = (await ctx.runMutation(internal.packages.reservePackageNameInternal, {
        actorUserId,
        ownerUserId: targetUser._id,
        ownerPublisherId,
        name,
        reason,
      })) as { action?: string };
      results.push({ kind: "package", name, ok: true, action: result.action });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Package reservation failed";
      results.push({ kind: "package", name, ok: false, error: message });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return json({ ok: true, results, succeeded, failed }, 200, headers);
}

async function handleAdminEnsurePublisher(
  ctx: ActionCtx,
  payload: Record<string, unknown>,
  actorUserId: Id<"users">,
  headers: HeadersInit,
) {
  const handle = typeof payload.handle === "string" ? payload.handle.trim().toLowerCase() : "";
  if (!handle) return text("Missing handle", 400, headers);

  const displayName =
    typeof payload.displayName === "string" ? payload.displayName.trim() : undefined;
  const trusted = typeof payload.trusted === "boolean" ? payload.trusted : undefined;
  const memberHandle =
    typeof payload.memberHandle === "string" ? payload.memberHandle.trim().toLowerCase() : "";
  const memberRoleRaw =
    typeof payload.memberRole === "string" ? payload.memberRole.trim().toLowerCase() : "";
  const memberRole =
    memberRoleRaw === "owner" || memberRoleRaw === "admin" || memberRoleRaw === "publisher"
      ? memberRoleRaw
      : undefined;
  if (memberRoleRaw && !memberRole) {
    return text("memberRole must be owner, admin, or publisher", 400, headers);
  }

  try {
    const result = await ctx.runMutation(internal.publishers.ensureOrgPublisherHandleInternal, {
      actorUserId,
      handle,
      displayName,
      ...(typeof trusted === "boolean" ? { trusted } : {}),
      ...(memberHandle ? { memberHandle } : {}),
      ...(memberRole ? { memberRole } : {}),
    });
    return json(result, 200, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publisher ensure failed";
    if (message.toLowerCase().includes("forbidden")) {
      return text("Forbidden", 403, headers);
    }
    if (message.toLowerCase().includes("not found")) {
      return text(message, 404, headers);
    }
    return text(message, 400, headers);
  }
}

async function handleBanAppealUnban(
  ctx: ActionCtx,
  request: Request,
  payload: Record<string, unknown>,
  headers: HeadersInit,
) {
  const service = requireBanAppealsServiceOrResponse(request, headers);
  if (!service.ok) return service.response;

  const targetUserIdRaw = typeof payload.userId === "string" ? payload.userId.trim() : "";
  if (!targetUserIdRaw) return text("Missing userId", 400, headers);

  const reasonRaw = typeof payload.reason === "string" ? payload.reason.trim() : "";
  const reviewerDiscordId =
    typeof payload.reviewerDiscordId === "string" ? payload.reviewerDiscordId.trim() : "";
  const reason = reasonRaw || "Ban appeal accepted";
  if (reason.length > 500) return text("Reason too long (max 500 chars)", 400, headers);
  if (!reviewerDiscordId) return text("Missing reviewerDiscordId", 400, headers);

  try {
    const result = await runUsersV1MutationRef(
      ctx,
      usersV1InternalRefs.users.unbanUserForBanAppealServiceInternal,
      {
        targetUserId: targetUserIdRaw as Id<"users">,
        reason,
        reviewerDiscordId,
      },
    );
    return json(result, 200, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ban appeal unban failed";
    if (message.toLowerCase().includes("forbidden")) return text("Forbidden", 403, headers);
    if (message.toLowerCase().includes("not found")) return text(message, 404, headers);
    return text(message, 400, headers);
  }
}

export async function banAppealContextV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const service = requireBanAppealsServiceOrResponse(request, rate.headers);
  if (!service.ok) return service.response;

  const providerAccountId = new URL(request.url).searchParams
    .get("githubProviderAccountId")
    ?.trim();
  if (!providerAccountId) return text("Missing githubProviderAccountId", 400, rate.headers);

  try {
    const result = await runUsersV1QueryRef(
      ctx,
      usersV1InternalRefs.users.getBanAppealContextByGitHubProviderAccountIdInternal,
      { providerAccountId },
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ban appeal context failed";
    return text(message, 400, rate.headers);
  }
}

async function handleAdminRemovePublisherMember(
  ctx: ActionCtx,
  payload: Record<string, unknown>,
  actorUserId: Id<"users">,
  headers: HeadersInit,
) {
  const handle = typeof payload.handle === "string" ? payload.handle.trim().toLowerCase() : "";
  const memberHandle =
    typeof payload.memberHandle === "string" ? payload.memberHandle.trim().toLowerCase() : "";
  if (!handle) return text("Missing handle", 400, headers);
  if (!memberHandle) return text("Missing memberHandle", 400, headers);

  try {
    const result = await runUsersV1MutationRef(
      ctx,
      usersV1InternalRefs.publishers.removeOrgPublisherMemberInternal,
      {
        actorUserId,
        handle,
        memberHandle,
      },
    );
    return json(result, 200, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publisher member removal failed";
    if (message.toLowerCase().includes("forbidden")) {
      return text("Forbidden", 403, headers);
    }
    if (message.toLowerCase().includes("not found")) {
      return text(message, 404, headers);
    }
    return text(message, 400, headers);
  }
}

export async function usersListV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const url = new URL(request.url);
  const limitRaw = toOptionalNumber(url.searchParams.get("limit"));
  const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const actorUserId = auth.userId;

  const limit = Math.min(Math.max(limitRaw ?? 20, 1), 200);
  try {
    const result = await ctx.runQuery(internal.users.searchInternal, {
      actorUserId,
      query,
      limit,
    });
    return json(result, 200, rate.headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "User search failed";
    if (message.toLowerCase().includes("forbidden")) {
      return text("Forbidden", 403, rate.headers);
    }
    if (message.toLowerCase().includes("unauthorized")) {
      return text(message, 401, rate.headers);
    }
    return text(message, 400, rate.headers);
  }
}
