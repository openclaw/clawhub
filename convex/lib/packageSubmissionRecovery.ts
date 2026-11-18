import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  assertManualPackagePublisher,
  assertRecoveryStorage,
  assertRecoveryModeration,
  recoveryReason,
} from "./packagePublishRecovery";
import { buildPackageInventoryDigest } from "./skills/skillMarkdown";
import { matchesStorageSha256 } from "./storageDigests";

export const submissionRecoveryRequestValidator = v.object({
  name: v.string(),
  version: v.string(),
  sourcePath: v.string(),
  inventoryDigest: v.string(),
  artifactSha256: v.string(),
  artifactSize: v.number(),
  originalRunId: v.string(),
  originalRunAttempt: v.string(),
  originalToolingSha: v.string(),
  manualOverrideReason: v.string(),
});
export type SubmissionRecoveryRequest = Infer<typeof submissionRecoveryRequestValidator>;
export const submissionRecoveryValidator = v.object({
  request: submissionRecoveryRequestValidator,
  originalTokenId: v.id("packagePublishTokens"),
  storageId: v.id("_storage"),
  actorUserId: v.id("users"),
  apiTokenId: v.id("apiTokens"),
  ownerUserId: v.id("users"),
  ownerPublisherId: v.optional(v.id("publishers")),
});
export type SubmissionRecovery = Infer<typeof submissionRecoveryValidator>;
type DbCtx = Pick<QueryCtx | MutationCtx, "db">;
type Authority = { actorUserId: Id<"users">; apiTokenId: Id<"apiTokens"> };
const states = [
  "pending_checks",
  "ready_to_finalize",
  "finalizing",
  "finalized",
  "blocked",
  "failed",
  "expired",
] as const;
export const submissionRecoveryKey = (id: Id<"packagePublishTokens">) =>
  `manual-submission-recovery:${id}`;

export function parseSubmissionRecoveryRequest(value: unknown): SubmissionRecoveryRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected submission recovery request");
  const body = value as Record<string, unknown>;
  const keys = Object.keys(submissionRecoveryRequestValidator.fields);
  if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key)))
    throw new Error("Unexpected submission recovery fields");
  const string = (key: string) => {
    const field = body[key];
    if (typeof field !== "string" || !field || field !== field.trim())
      throw new Error(`Invalid ${key}`);
    return field;
  };
  const result = {
    name: string("name"),
    version: string("version"),
    sourcePath: string("sourcePath"),
    inventoryDigest: string("inventoryDigest"),
    artifactSha256: string("artifactSha256"),
    artifactSize: body.artifactSize,
    originalRunId: string("originalRunId"),
    originalRunAttempt: string("originalRunAttempt"),
    originalToolingSha: string("originalToolingSha"),
    manualOverrideReason: recoveryReason(string("manualOverrideReason")),
  };
  if (
    result.sourcePath.startsWith("/") ||
    result.sourcePath.includes("\\") ||
    result.sourcePath.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^@openclaw\/[a-z0-9][a-z0-9._-]*$/.test(result.name) ||
    !/^[a-f0-9]{64}$/.test(result.inventoryDigest) ||
    !/^[a-f0-9]{64}$/.test(result.artifactSha256) ||
    !/^[a-f0-9]{40}$/.test(result.originalToolingSha) ||
    !/^[1-9][0-9]*$/.test(result.originalRunId) ||
    !/^[1-9][0-9]*$/.test(result.originalRunAttempt) ||
    typeof result.artifactSize !== "number" ||
    !Number.isSafeInteger(result.artifactSize) ||
    result.artifactSize <= 0
  )
    throw new Error("Invalid submission recovery identity or digest");
  return { ...result, artifactSize: result.artifactSize };
}

export function submissionRecovery(value: unknown): SubmissionRecovery | undefined {
  return value && typeof value === "object"
    ? (value as { submissionRecovery?: SubmissionRecovery }).submissionRecovery
    : undefined;
}

export async function originalSubmissionContext(
  ctx: DbCtx,
  request: SubmissionRecoveryRequest,
  authority: Authority,
  now: number,
) {
  const pkg = await ctx.db
    .query("packages")
    .withIndex("by_name", (q) => q.eq("normalizedName", request.name))
    .unique();
  if (!pkg || (pkg.family !== "code-plugin" && pkg.family !== "bundle-plugin"))
    throw new ConvexError("Original submission not found");
  await assertManualPackagePublisher(ctx, pkg, authority.actorUserId, authority.apiTokenId);
  const token = await ctx.db
    .query("packagePublishTokens")
    .withIndex("by_package", (q) => q.eq("packageId", pkg._id).eq("version", request.version))
    .filter((q) =>
      q.and(
        q.eq(q.field("repository"), "openclaw/openclaw"),
        q.eq(q.field("scope"), "publish"),
        q.eq(q.field("runId"), request.originalRunId),
        q.eq(q.field("runAttempt"), request.originalRunAttempt),
        q.eq(q.field("sha"), request.originalToolingSha),
        q.eq(q.field("inventoryDigest"), request.inventoryDigest),
      ),
    )
    .unique();
  if (
    !token ||
    token.authorizationVersion !== 2 ||
    !token.authorizationTransactionKey ||
    !token.candidateSha
  )
    throw new ConvexError("Original submission not found");
  const existing = await ctx.db
    .query("publishAttempts")
    .withIndex("by_idempotency_key", (q) =>
      q.eq("idempotencyKey", submissionRecoveryKey(token._id)),
    )
    .unique();
  if (existing) {
    const binding = submissionRecovery(existing.packageFollowup);
    if (
      !binding ||
      existing.packageId !== pkg._id ||
      binding.originalTokenId !== token._id ||
      binding.request.artifactSha256 !== request.artifactSha256 ||
      binding.request.artifactSize !== request.artifactSize ||
      binding.request.inventoryDigest !== request.inventoryDigest ||
      binding.request.sourcePath !== request.sourcePath
    )
      throw new ConvexError("Submission recovery binding changed");
    // Replays return recorded outcomes, including secret-blocked releases whose blobs are gone.
    return { pkg, token, existing, storageId: binding.storageId };
  }
  if (token.consumedAt || token.revokedAt || token.expiresAt > now)
    throw new ConvexError(
      "Original submission is consumed, revoked, or still live; reconcile its outcome before recovery",
    );
  const release = await ctx.db
    .query("packageReleases")
    .withIndex("by_package_version", (q) =>
      q.eq("packageId", pkg._id).eq("version", request.version),
    )
    .first();
  if (release)
    throw new ConvexError("A release already exists; use its recorded publication recovery");
  for (const status of states) {
    const attempt = await ctx.db
      .query("publishAttempts")
      .withIndex("by_kind_status_slug_version_created", (q) =>
        q
          .eq("kind", "package")
          .eq("status", status)
          .eq("slug", request.name)
          .eq("version", request.version),
      )
      .first();
    if (attempt)
      throw new ConvexError(
        "A publication attempt already exists, including retained audit history; reconcile it before recovery",
      );
  }
  const upload = await ctx.db
    .query("packagePublishTokens")
    .withIndex("by_package", (q) => q.eq("packageId", pkg._id).eq("version", request.version))
    .filter((q) =>
      q.and(
        q.eq(q.field("scope"), "upload"),
        q.eq(q.field("authorizationTransactionKey"), token.authorizationTransactionKey),
      ),
    )
    .unique();
  if (
    !upload ||
    !upload.consumedAt ||
    upload.revokedAt ||
    upload.authorizationVersion !== 2 ||
    upload.provider !== token.provider ||
    upload.repository !== token.repository ||
    upload.runId !== token.runId ||
    upload.runAttempt !== token.runAttempt ||
    upload.sha !== token.sha ||
    upload.candidateSha !== token.candidateSha ||
    upload.inventoryDigest !== token.inventoryDigest
  )
    throw new ConvexError("Original upload authorization is unavailable");
  const ticket = await ctx.db
    .query("packagePublishUploadTickets")
    .withIndex("by_publish_token", (q) => q.eq("publishTokenId", upload._id))
    .unique();
  if (
    !ticket?.usedAt ||
    !ticket.storageId ||
    ticket.authorizationTransactionKey !== token.authorizationTransactionKey
  )
    throw new ConvexError("Original consumed upload ticket is unavailable");
  const storage = await ctx.db.system.get(ticket.storageId);
  if (
    !storage ||
    storage.size !== request.artifactSize ||
    !matchesStorageSha256(storage.sha256, request.artifactSha256)
  )
    throw new ConvexError("Original submission archive bytes changed or are unavailable");
  return { pkg, token, storageId: ticket.storageId, existing: null };
}

type Artifact = Pick<
  Doc<"packageReleases">,
  "files" | "clawpackStorageId" | "clawpackSha256" | "clawpackSize"
>;
export async function assertSubmissionRecoveryInsert(
  ctx: DbCtx,
  binding: SubmissionRecovery,
  artifact: Artifact,
  now: number,
) {
  const context = await originalSubmissionContext(ctx, binding.request, binding, now);
  if (
    context.existing ||
    context.token._id !== binding.originalTokenId ||
    context.storageId !== binding.storageId ||
    context.pkg.ownerUserId !== binding.ownerUserId ||
    context.pkg.ownerPublisherId !== binding.ownerPublisherId ||
    artifact.clawpackStorageId !== binding.storageId ||
    artifact.clawpackSha256 !== binding.request.artifactSha256 ||
    artifact.clawpackSize !== binding.request.artifactSize ||
    (await buildPackageInventoryDigest(artifact.files)) !== binding.request.inventoryDigest
  )
    throw new ConvexError("Submission recovery artifact or owner changed");
  return context.pkg;
}

export async function assertSubmissionRecoveryFinalization(
  ctx: DbCtx,
  pkg: Doc<"packages">,
  release: Doc<"packageReleases">,
  attemptId: Id<"publishAttempts"> | undefined,
  claimId: string | undefined,
) {
  const binding = submissionRecovery(release.pendingPublication);
  const attempt = attemptId ? await ctx.db.get(attemptId) : null;
  const token = binding ? await ctx.db.get(binding.originalTokenId) : null;
  if (
    !binding ||
    !attempt ||
    !token ||
    !claimId ||
    release.publishAttemptId !== attempt._id ||
    attempt.status !== "finalizing" ||
    attempt.finalizationClaimId !== claimId ||
    (attempt.finalizationClaimExpiresAt ?? 0) <= Date.now() ||
    attempt.checks.trufflehog.status !== "clean" ||
    attempt.checks.clawscan.status !== "clean" ||
    JSON.stringify(submissionRecovery(attempt.packageFollowup)) !== JSON.stringify(binding) ||
    pkg.ownerUserId !== binding.ownerUserId ||
    pkg.ownerPublisherId !== binding.ownerPublisherId ||
    token.consumedAt ||
    token.revokedAt ||
    token.packageId !== pkg._id ||
    token.version !== release.version ||
    token.authorizationVersion !== 2 ||
    token.provider !== "github-actions" ||
    token.scope !== "publish" ||
    token.repository !== "openclaw/openclaw" ||
    token.runId !== binding.request.originalRunId ||
    token.runAttempt !== binding.request.originalRunAttempt ||
    token.sha !== binding.request.originalToolingSha ||
    release.source?.repo !== (token.candidateRepository ?? token.repository) ||
    release.source?.commit !== token.candidateSha ||
    release.source?.path !== binding.request.sourcePath ||
    token.inventoryDigest !== binding.request.inventoryDigest ||
    release.clawpackStorageId !== binding.storageId ||
    release.clawpackSha256 !== binding.request.artifactSha256 ||
    release.clawpackSize !== binding.request.artifactSize ||
    (await buildPackageInventoryDigest(release.files)) !== binding.request.inventoryDigest
  )
    throw new ConvexError(
      "Submission recovery finalization binding, checks, or original outcome changed",
    );
  await assertManualPackagePublisher(ctx, pkg, binding.actorUserId, binding.apiTokenId);
  assertRecoveryModeration(release, attempt);
  await assertRecoveryStorage(ctx, release);
  return binding;
}
