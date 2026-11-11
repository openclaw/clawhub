export { contentDispositionAttachment } from "../lib/contentDisposition";
import {
  CliPublishRequestSchema,
  decodeUtf8Text,
  getClawHubRuntimeEnvironment,
  normalizeContentType,
  parseArk,
  type ArkValidator,
} from "clawhub-schema";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { assertAdmin, assertModerator } from "../lib/access";
import { requireApiTokenUser, requirePackagePublishAuth } from "../lib/apiTokenAuth";
import { sha256Hex } from "../lib/hash";
import { corsHeaders, mergeHeaders, json, text } from "../lib/httpHeaders";
import { getTransientConvexErrorKind } from "../lib/httpUtils";
import { getPublishFileSizeError, MAX_PUBLISH_FILE_BYTES } from "../lib/publishLimits";
import { isMacJunkPath } from "../lib/skills";
import type { PublicSkillVersionSelection } from "../lib/skills/publicVersions";
export { getPathSegments, parsePackagePathSegments } from "../lib/httpPathSegments";

export { MAX_RAW_FILE_BYTES } from "../lib/storageText";
const DEFAULT_PUBLIC_SITE_URL = "https://clawhub.ai";

const SAFE_TEXT_FILE_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function attachmentDisposition(path: string) {
  const leaf = path.split("/").at(-1) || "download";
  return `attachment; filename*=UTF-8''${encodeURIComponent(leaf)}`;
}

type SafeFileResponseParams = {
  path: string;
  contentType?: string;
  sha256: string;
  size: number;
  headers?: HeadersInit;
};

function safeFileResponseHeaders(
  params: SafeFileResponseParams,
  contentType: string,
  forceAttachment: boolean,
) {
  return mergeHeaders(
    params.headers,
    {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60",
      ETag: params.sha256,
      "X-Content-SHA256": params.sha256,
      "X-Content-Size": String(params.size),
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": SAFE_TEXT_FILE_CSP,
      ...(forceAttachment ? { "Content-Disposition": attachmentDisposition(params.path) } : {}),
    },
    corsHeaders(),
  );
}

export function safeTextFileResponse(params: SafeFileResponseParams & { textContent: string }) {
  const normalized = normalizeContentType(params.contentType);
  const contentType = normalized ? `${normalized}; charset=utf-8` : "text/plain; charset=utf-8";
  const headers = safeFileResponseHeaders(params, contentType, false);

  return new Response(params.textContent, { status: 200, headers });
}

export async function safeStoredFileResponse(
  params: SafeFileResponseParams & {
    blob: Blob;
  },
) {
  const bytes = new Uint8Array(await params.blob.arrayBuffer());
  const contentType = normalizeContentType(params.contentType) ?? "application/octet-stream";

  return new Response(bytes, {
    status: 200,
    headers: safeFileResponseHeaders(params, contentType, true),
  });
}

export async function safeStoredFilePreviewResponse(
  params: SafeFileResponseParams & {
    blob: Blob;
  },
) {
  const bytes = new Uint8Array(await params.blob.arrayBuffer());
  const textContent = decodeUtf8Text(bytes);
  if (textContent === null) {
    return text("File cannot be previewed as text", 415, params.headers);
  }

  return new Response(textContent, {
    status: 200,
    headers: safeFileResponseHeaders(params, "text/plain; charset=utf-8", false),
  });
}

export { json } from "../lib/httpHeaders";

export { text } from "../lib/httpHeaders";

export type AmbiguousSkillSlugChoice = {
  ownerHandle: string;
  slug: string;
  ref: string;
  url: string;
};

export function ambiguousSkillSlugMessage(slug: string, examplePath?: string) {
  if (!examplePath) {
    return `Found multiple skills with the slug "${slug}"; specify which one you want to install:`;
  }
  return (
    `Ambiguous skill slug "${slug}". Multiple publishers use this slug. ` +
    `Retry with ownerHandle, for example: ${examplePath}.`
  );
}

export function ambiguousSkillSlugResponse(
  slug: string,
  examplePath: string,
  headers?: HeadersInit,
  choices?: AmbiguousSkillSlugChoice[],
) {
  if (choices && choices.length > 0) {
    return json(
      {
        code: "AMBIGUOUS_SKILL_SLUG",
        message: ambiguousSkillSlugMessage(slug),
        slug,
        matches: choices,
      },
      409,
      headers,
    );
  }
  return text(ambiguousSkillSlugMessage(slug, examplePath), 409, headers);
}

export async function parseJsonPayload(request: Request, headers: HeadersInit) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    return { ok: true as const, payload };
  } catch {
    return { ok: false as const, response: text("Invalid JSON", 400, headers) };
  }
}

export async function moderationDecisionResponse(
  ctx: ActionCtx,
  request: Request,
  headers: HeadersInit,
  schema: ArkValidator<{ status: string; note?: string; finalAction?: string }>,
  label: string,
  fallback: string,
  resolveMutation: () => { ref: unknown; args: Record<string, unknown> },
) {
  try {
    const body = parseArk(schema, await request.json(), label);
    const { ref, args } = resolveMutation();
    const result = await ctx.runMutation(
      ref as never,
      {
        ...args,
        status: body.status,
        ...(body.note ? { note: body.note } : {}),
        ...(body.finalAction ? { finalAction: body.finalAction } : {}),
      } as never,
    );
    return json(result, 200, headers);
  } catch (error) {
    return text(error instanceof Error ? error.message : fallback, 400, headers);
  }
}

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function isProductionDeployment() {
  const deployment = process.env.CONVEX_DEPLOYMENT?.trim() ?? "";
  return (
    (deployment.startsWith("prod:") || deployment.includes("production")) &&
    getClawHubRuntimeEnvironment(process.env) === "production"
  );
}

function isTrustedForwardedHost(value: string) {
  try {
    const hostname = new URL(`https://${value}`).hostname.toLowerCase();
    return (
      hostname === "clawhub.ai" ||
      hostname === "www.clawhub.ai" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

export function publicApiOrigin(request: Request) {
  const configured = normalizeOrigin(process.env.SITE_URL ?? process.env.VITE_SITE_URL);
  if (configured) return configured;

  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  if (
    forwardedHost &&
    !forwardedHost.endsWith(".convex.site") &&
    isTrustedForwardedHost(forwardedHost)
  ) {
    const forwardedProto =
      firstForwardedValue(request.headers.get("x-forwarded-proto")) ??
      firstForwardedValue(request.headers.get("x-forwarded-protocol")) ??
      "https";
    const proto = forwardedProto === "http" ? "http" : "https";
    return `${proto}://${forwardedHost}`;
  }

  const requestUrl = new URL(request.url);
  if (isProductionDeployment() && requestUrl.hostname.endsWith(".convex.site")) {
    return DEFAULT_PUBLIC_SITE_URL;
  }
  return requestUrl.origin;
}

export async function requireApiTokenUserOrResponse(
  ctx: ActionCtx,
  request: Request,
  headers: HeadersInit,
) {
  try {
    const auth = await requireApiTokenUser(ctx, request);
    return {
      ok: true as const,
      userId: auth.userId,
      user: auth.user as Doc<"users">,
      apiTokenId: auth.apiTokenId,
    };
  } catch (error) {
    return { ok: false as const, response: authFailureResponse(error, headers) };
  }
}

export async function requirePackagePublishAuthOrResponse(
  ctx: ActionCtx,
  request: Request,
  headers: HeadersInit,
) {
  try {
    return { ok: true as const, auth: await requirePackagePublishAuth(ctx, request) };
  } catch (error) {
    return { ok: false as const, response: authFailureResponse(error, headers) };
  }
}

// A platform failure while reading the token is not an authentication failure:
// answering 401 would tell a valid publisher to log in again.
function authFailureResponse(error: unknown, headers: HeadersInit) {
  return (
    transientConvexErrorResponse(error, headers) ?? text(formatAuthFailure(error), 401, headers)
  );
}

export function requireAdminOrResponse(user: Doc<"users">, headers: HeadersInit) {
  try {
    assertAdmin(user);
    return { ok: true as const };
  } catch {
    return { ok: false as const, response: text("Admin role required.", 403, headers) };
  }
}

export function requireModeratorOrResponse(user: Doc<"users">, headers: HeadersInit) {
  try {
    assertModerator(user);
    return { ok: true as const };
  } catch {
    return { ok: false as const, response: text("Moderator role required.", 403, headers) };
  }
}

export function toOptionalNumber(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Batch checked selections without one action RPC per catalog item. */
export async function readPublicSkillVersionSelections(
  ctx: ActionCtx,
  selections: Array<{ skillId: Id<"skills">; versionId: Id<"skillVersions"> }>,
): Promise<PublicSkillVersionSelection[]> {
  const results: PublicSkillVersionSelection[] = [];
  // A selection reads two potentially large documents; keep each transaction
  // below the read-byte limit even for near-limit version file manifests.
  const batchSize = 5;
  for (let offset = 0; offset < selections.length; offset += batchSize * 4) {
    const batches: Array<Promise<PublicSkillVersionSelection[]>> = [];
    for (
      let start = offset;
      start < Math.min(selections.length, offset + batchSize * 4);
      start += batchSize
    ) {
      batches.push(
        ctx.runQuery(internal.skills.getPublicVersionSelectionsInternal, {
          selections: selections.slice(start, start + batchSize),
        }),
      );
    }
    for (const batch of await Promise.all(batches)) results.push(...batch);
  }
  return results;
}

/** Check latest and tag targets together; cached summaries omit lifecycle state. */
export async function resolvePublicSkillVersions(
  ctx: ActionCtx,
  items: Array<{
    skillId: Id<"skills">;
    tags: Record<string, Id<"skillVersions">>;
    latestVersionId?: Id<"skillVersions">;
  }>,
): Promise<Array<{ tags: Record<string, string>; latestVersion: Doc<"skillVersions"> | null }>> {
  const selections = new Map<string, { skillId: Id<"skills">; versionId: Id<"skillVersions"> }>();
  const selectionKey = (skillId: Id<"skills">, versionId: Id<"skillVersions">) =>
    `${skillId}/${versionId}`;
  for (const { skillId, tags, latestVersionId } of items) {
    const versionIds = Object.values(tags);
    if (latestVersionId) versionIds.push(latestVersionId);
    for (const versionId of versionIds)
      selections.set(selectionKey(skillId, versionId), { skillId, versionId });
  }
  const keys = [...selections.keys()].sort();
  const selected = await readPublicSkillVersionSelections(
    ctx,
    keys.map((key) => selections.get(key)!),
  );
  const selectionMap = new Map(keys.map((key, index) => [key, selected[index]]));
  return items.map(({ skillId, tags, latestVersionId }) => {
    const resolved: Record<string, string> = {};
    for (const [tag, versionId] of Object.entries(tags)) {
      const selection = selectionMap.get(selectionKey(skillId, versionId));
      // A published target can outlive a removed or repointed tag in a cached snapshot.
      if (selection?.status === "available" && selection.skill.tags[tag] === versionId)
        resolved[tag] = selection.version.version;
    }
    const latest = latestVersionId
      ? selectionMap.get(selectionKey(skillId, latestVersionId))
      : undefined;
    return {
      tags: resolved,
      latestVersion: latest?.status === "available" ? latest.version : null,
    };
  });
}

type FileLike = {
  name: string;
  size: number;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type FileLikeEntry = FormDataEntryValue & FileLike;

function toFileLike(entry: FormDataEntryValue): FileLikeEntry | null {
  if (typeof entry === "string") return null;
  const candidate = entry as Partial<FileLike>;
  if (typeof candidate.name !== "string") return null;
  if (typeof candidate.size !== "number") return null;
  if (typeof candidate.arrayBuffer !== "function") return null;
  return entry as FileLikeEntry;
}

export async function deleteStoredMultipartFiles(
  ctx: ActionCtx,
  files: Array<{ storageId: Id<"_storage"> }>,
) {
  await Promise.allSettled(files.map((file) => ctx.storage.delete(file.storageId)));
}

export async function parseMultipartPublish(
  ctx: ActionCtx,
  request: Request,
): Promise<ReturnType<typeof parsePublishBody>> {
  const form = await request.formData();
  const payloadRaw = form.get("payload");
  if (!payloadRaw || typeof payloadRaw !== "string") {
    throw new Error("Missing payload");
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadRaw) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON payload");
  }

  const fileEntries = form
    .getAll("files")
    .map((entry) => toFileLike(entry))
    .filter((file): file is FileLikeEntry => Boolean(file))
    .filter((file) => !isMacJunkPath(file.name));
  const oversized = fileEntries.find((file) => file.size > MAX_PUBLISH_FILE_BYTES);
  if (oversized) throw new Error(getPublishFileSizeError(oversized.name));

  const files: Array<{
    path: string;
    size: number;
    storageId: Id<"_storage">;
    sha256: string;
    contentType?: string;
  }> = [];

  try {
    for (const file of fileEntries) {
      const path = file.name;
      const size = file.size;
      const contentType = file.type || undefined;
      const buffer = new Uint8Array(await file.arrayBuffer());
      const sha256 = await sha256Hex(buffer);
      const storageId = await ctx.storage.store(file as Blob);
      files.push({ path, size, storageId, sha256, contentType });
    }

    const forkOf =
      payload.forkOf && typeof payload.forkOf === "object" ? payload.forkOf : undefined;
    const hasAcceptLicenseTerms = Object.prototype.hasOwnProperty.call(
      payload,
      "acceptLicenseTerms",
    );
    const body = {
      slug: payload.slug,
      displayName: payload.displayName,
      ...(typeof payload.ownerHandle === "string" ? { ownerHandle: payload.ownerHandle } : {}),
      ...(typeof payload.sourceOwnerHandle === "string"
        ? { sourceOwnerHandle: payload.sourceOwnerHandle }
        : {}),
      ...(typeof payload.migrateOwner === "boolean" ? { migrateOwner: payload.migrateOwner } : {}),
      version: payload.version,
      changelog: typeof payload.changelog === "string" ? payload.changelog : "",
      ...(hasAcceptLicenseTerms ? { acceptLicenseTerms: payload.acceptLicenseTerms } : {}),
      tags: Array.isArray(payload.tags) ? payload.tags : undefined,
      ...(Array.isArray(payload.categories) ? { categories: payload.categories } : {}),
      ...(Array.isArray(payload.topics) ? { topics: payload.topics } : {}),
      ...(payload.source ? { source: payload.source } : {}),
      files,
      ...(forkOf ? { forkOf } : {}),
    };

    return parsePublishBody(body);
  } catch (error) {
    await deleteStoredMultipartFiles(ctx, files);
    throw error;
  }
}

export function parsePublishBody(body: unknown) {
  const parsed = parseArk(CliPublishRequestSchema, body, "Publish payload");
  if (parsed.files.length === 0) throw new Error("files required");
  const tags = parsed.tags && parsed.tags.length > 0 ? parsed.tags : undefined;
  return {
    slug: parsed.slug,
    displayName: parsed.displayName,
    ownerHandle: parsed.ownerHandle?.trim().replace(/^@+/, "") || undefined,
    sourceOwnerHandle: parsed.sourceOwnerHandle?.trim().replace(/^@+/, "") || undefined,
    migrateOwner: parsed.migrateOwner === true ? true : undefined,
    version: parsed.version,
    changelog: parsed.changelog,
    acceptLicenseTerms: parsed.acceptLicenseTerms,
    tags,
    categories: parsed.categories,
    topics: parsed.topics,
    source: parsed.source ?? undefined,
    forkOf: parsed.forkOf
      ? {
          slug: parsed.forkOf.slug,
          ownerHandle: parsed.forkOf.ownerHandle?.trim().replace(/^@+/, "") || undefined,
          version: parsed.forkOf.version ?? undefined,
        }
      : undefined,
    files: parsed.files.map((file) => ({
      ...file,
      storageId: file.storageId as Id<"_storage">,
      uploadTicket: file.uploadTicket as Id<"skillPublishUploadTickets"> | undefined,
    })),
  };
}

// Substrings that indicate user-input validation failures from the underlying
// mutations (e.g. `normalizePackageName` ConvexErrors). These are surfaced as
// 400s with the cleaned message so CLI/API clients can see the actual reason
// instead of an opaque 500.
const SOFT_DELETE_BAD_REQUEST_HINTS = [
  "slug required",
  "package name required",
  "package name must be",
  "must be lowercase",
  "npm-safe",
  "reserved for clawhub routes",
  "version required",
] as const;

export function softDeleteErrorToResponse(
  entity: "skill" | "package",
  error: unknown,
  headers: HeadersInit,
) {
  const rawMessage = error instanceof Error ? error.message : `${entity} delete failed`;
  const cleaned = cleanUserFacingErrorMessage(rawMessage) || rawMessage;
  const lower = cleaned.toLowerCase();

  if (lower.includes("unauthorized"))
    return text(formatAuthzMessage(error, "Unauthorized"), 401, headers);
  if (lower.includes("forbidden"))
    return text(formatAuthzMessage(error, "Forbidden"), 403, headers);
  if (lower.includes("not found")) return text(cleaned, 404, headers);
  if (lower.includes("multiple publishers") || lower.includes("owner-qualified")) {
    return text(cleaned, 409, headers);
  }
  if (SOFT_DELETE_BAD_REQUEST_HINTS.some((hint) => lower.includes(hint))) {
    return text(cleaned, 400, headers);
  }

  // Unknown: server-side failure. Keep the body generic; only known
  // user-input validation failures above surface the cleaned mutation message.
  return text("Internal Server Error", 500, headers);
}

export function cleanUserFacingErrorMessage(message: string) {
  let cleaned = message
    .replace(/\[CONVEX[^\]]*\]\s*/g, "")
    .replace(/\[Request ID:[^\]]*\]\s*/g, "")
    .replace(/\n\s+at [\s\S]*$/, "")
    .replace(/^Server Error Called by client\s*/i, "")
    .trim();

  for (let i = 0; i < 3; i += 1) {
    const next = cleaned
      .replace(/^Error:\s*/i, "")
      .replace(/^(?:Uncaught\s+)?ConvexError:\s*/i, "")
      .trim();
    if (next === cleaned) break;
    cleaned = next;
  }

  return cleaned;
}

export function formatUserFacingErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return cleanUserFacingErrorMessage(message) || fallback;
}

// Seconds a client should wait before retrying a request that hit a transient
// Convex platform failure. Write conflicts clear fastest; system/overload
// errors get a little longer so retries do not pile onto a struggling backend.
const TRANSIENT_WRITE_CONFLICT_RETRY_AFTER_SECONDS = 1;
const TRANSIENT_SYSTEM_ERROR_RETRY_AFTER_SECONDS = 2;
const TRANSIENT_SYSTEM_ERROR_MAX_RETRY_AFTER_SECONDS = 30;
// Convex write-admission errors end with "(reset in 43s)". That is backend
// capacity, not the caller's rate limit: move it into Retry-After instead of
// echoing text that reads like a quota reset.
const CONVEX_CAPACITY_RESET_PATTERN = /\s*\(reset in (\d+)s\)/;

/**
 * Map a transient Convex platform failure (overload, internal/transient system
 * error, write conflict) to a retryable 503 with `Retry-After`. Returns null for
 * every other error so callers keep their validation/authorization mapping.
 * Such failures are never a client error, so they must not become 4xx, and
 * they are not rate limiting, so no rate-limit headers are added.
 */
export function transientConvexErrorResponse(
  error: unknown,
  headers?: HeadersInit,
  options: {
    // The request may have committed before the failure surfaced.
    outcomeUnknown?: boolean;
    // The request consumed one-shot state (for example upload tickets) before
    // failing, so resending it can never succeed: answer 409 without
    // Retry-After instead of inviting a futile automatic retry.
    restartRequired?: boolean;
  } = {},
): Response | null {
  const kind = getTransientConvexErrorKind(error);
  if (!kind) return null;
  const raw = (error as Error).message;
  const capacityReset = CONVEX_CAPACITY_RESET_PATTERN.exec(raw)?.[1];
  const detail = cleanUserFacingErrorMessage(raw.replace(CONVEX_CAPACITY_RESET_PATTERN, ""));
  // Keep the Convex request ID so operators can correlate the failure.
  const requestId = /\[Request ID: ([^\]]+)\]/.exec(raw)?.[1];
  const summary =
    kind === "write_conflict"
      ? "Transient ClawHub write contention"
      : "ClawHub backend is temporarily unavailable";
  const outcome = options.restartRequired
    ? "The request was not rejected for validation, but the failure happened after it saved its uploaded files, so the same request cannot be retried. It may have completed; check the version, and otherwise run publish again to upload the files again."
    : options.outcomeUnknown
      ? "The request was not rejected for validation, but it may have completed before the failure; if a retry reports a conflict such as an existing version, check the current state before changing anything."
      : "The request was not rejected for validation; retrying usually succeeds.";
  const body = [`${summary}.`, outcome, detail, requestId ? `[Request ID: ${requestId}]` : ""]
    .filter(Boolean)
    .join(" ");
  console.warn("http_transient_convex_error", { kind, restartRequired: !!options.restartRequired });
  if (options.restartRequired) return text(body, 409, headers);
  const retryAfter =
    kind === "write_conflict"
      ? TRANSIENT_WRITE_CONFLICT_RETRY_AFTER_SECONDS
      : Math.min(
          TRANSIENT_SYSTEM_ERROR_MAX_RETRY_AFTER_SECONDS,
          Math.max(TRANSIENT_SYSTEM_ERROR_RETRY_AFTER_SECONDS, Number(capacityReset ?? 0)),
        );
  return text(body, 503, mergeHeaders(headers, { "Retry-After": String(retryAfter) }));
}

function formatAuthFailure(error: unknown) {
  const message = formatUserFacingErrorMessage(error, "");
  if (!message || /^unauthorized$/i.test(message)) return "Unauthorized";
  return message || "Unauthorized";
}

// Shared formatter for authz responses.
// - Returns the clean fallback ("Unauthorized" | "Forbidden") when the error
//   carries no additional context beyond the fallback itself (so existing
//   callers that throw `new Error("Forbidden")` keep their body unchanged).
// - Otherwise returns the full message (minus the `ConvexError:` prefix) so
//   CLI/API clients can surface actionable reasons such as
//   "Forbidden: This skill was hidden by moderation ...".
export function formatAuthzMessage(error: unknown, fallback: "Unauthorized" | "Forbidden") {
  const message = formatUserFacingErrorMessage(error, "");
  if (!message) return fallback;
  const stripped = cleanUserFacingErrorMessage(message);
  if (!stripped || stripped.toLowerCase() === fallback.toLowerCase()) return fallback;
  return stripped;
}

/**
 * Lets the public edge cache anonymous catalog reads briefly. Cached responses
 * skip the batched public-version checks that dominate database reads.
 * Requests with credentials are never marked cacheable.
 */
export function anonymousCatalogCacheHeaders(request: Request, headers: HeadersInit): HeadersInit {
  if (request.headers.has("authorization") || request.headers.has("cookie")) return headers;
  return mergeHeaders(headers, {
    "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  });
}

export async function readOptionalJson(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw.trim()) return undefined;
  return JSON.parse(raw) as unknown;
}

export function optionalStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function hasOwnField(value: unknown, key: string) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value as Record<string, unknown>, key),
  );
}

export function resolveVersionPathTarget(
  pathVersion: string | undefined,
  request: Request,
  body: unknown,
): { version?: string; error?: string } {
  const rawBodyVersion = optionalStringField(body, "version");
  if (hasOwnField(body, "version") && rawBodyVersion === undefined) {
    return { error: "Version must be a non-empty string" };
  }
  const version = pathVersion?.trim();
  const bodyVersion = rawBodyVersion?.trim();
  const queryVersions = new URL(request.url).searchParams
    .getAll("version")
    .map((queryVersion) => queryVersion.trim());
  if (
    !version ||
    (rawBodyVersion !== undefined && !bodyVersion) ||
    queryVersions.some((queryVersion) => !queryVersion)
  ) {
    return { error: "Version cannot be empty" };
  }
  if (
    (bodyVersion && bodyVersion !== version) ||
    queryVersions.some((queryVersion) => queryVersion !== version)
  ) {
    return { error: "Version does not match request target" };
  }
  return { version };
}

export function hasVersionDeleteSelector(request: Request, body: unknown) {
  return hasOwnField(body, "version") || new URL(request.url).searchParams.has("version");
}

export function versionDeleteRouteGuidance(basePath: string, request: Request, body: unknown) {
  const version =
    optionalStringField(body, "version")?.trim() ??
    new URL(request.url).searchParams.get("version")?.trim();
  return `Version deletion requires DELETE ${basePath}/versions/${
    version ? encodeURIComponent(version) : "<version>"
  }.`;
}

export async function chunkedParallel<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}
