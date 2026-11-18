import type { ServerPackagePublishRequest } from "clawhub-schema";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./functions";
import { requireGitHubAccountAge } from "./lib/githubAccount";
import {
  originalSubmissionContext,
  submissionRecoveryRequestValidator,
  type SubmissionRecoveryRequest,
  type SubmissionRecovery,
} from "./lib/packageSubmissionRecovery";

const authority = { actorUserId: v.id("users"), apiTokenId: v.id("apiTokens") };
type Args = {
  request: SubmissionRecoveryRequest;
  actorUserId: Id<"users">;
  apiTokenId: Id<"apiTokens">;
};
export type SubmissionRecoveryResult = {
  ok: true;
  attemptId: Id<"publishAttempts">;
  recoveredFromSubmissionId: Id<"packagePublishTokens">;
  packageId: Id<"packages">;
  releaseId: Id<"packageReleases">;
  name: string;
  version: string;
  status: Doc<"publishAttempts">["status"];
  publicationStatus: "published" | "pending" | "blocked" | "failed" | "expired";
  reused: boolean;
};
const contextRef = makeFunctionReference<
  "query",
  Args & { now: number },
  Awaited<ReturnType<typeof originalSubmissionContext>>
>("packageSubmissionRecovery:contextInternal");
const prepareRef = makeFunctionReference<
  "action",
  { artifactStorageId: Id<"_storage">; metadataJson: string },
  { payloadJson: string; requestStorageIds: Id<"_storage">[] }
>("packageClawpackNode:prepareClawPackInternal");
const publishRef = makeFunctionReference<
  "action",
  {
    actorUserId: Id<"users">;
    payload: unknown;
    requestStorageIds: Id<"_storage">[];
    submissionRecovery: SubmissionRecovery;
    requireSecurityChecks: boolean;
  },
  unknown
>("packages:publishPackageForUserInternal");

export const contextInternal = internalQuery({
  args: { request: submissionRecoveryRequestValidator, ...authority, now: v.number() },
  handler: (ctx, args) => originalSubmissionContext(ctx, args.request, args, args.now),
});
function result(
  attempt: Doc<"publishAttempts">,
  original: Id<"packagePublishTokens">,
  reused: boolean,
): SubmissionRecoveryResult {
  const status = attempt.status;
  return {
    ok: true,
    attemptId: attempt._id,
    recoveredFromSubmissionId: original,
    packageId: attempt.packageId!,
    releaseId: attempt.packageReleaseId!,
    name: attempt.slug,
    version: attempt.version,
    status,
    publicationStatus:
      status === "finalized"
        ? "published"
        : status === "blocked" || status === "failed" || status === "expired"
          ? status
          : "pending",
    reused,
  };
}
export const recoverInternal = internalAction({
  args: { request: submissionRecoveryRequestValidator, ...authority },
  handler: async (ctx, args): Promise<SubmissionRecoveryResult> => {
    const before = await ctx.runQuery(contextRef, { ...args, now: Date.now() });
    if (before.existing) return result(before.existing, before.token._id, true);
    await requireGitHubAccountAge(ctx, args.actorUserId);
    const binding: SubmissionRecovery = {
      request: args.request,
      originalTokenId: before.token._id,
      storageId: before.storageId,
      actorUserId: args.actorUserId,
      apiTokenId: args.apiTokenId,
      ownerUserId: before.pkg.ownerUserId,
      ...(before.pkg.ownerPublisherId ? { ownerPublisherId: before.pkg.ownerPublisherId } : {}),
    };
    const prepared = await ctx.runAction(prepareRef, {
      artifactStorageId: before.storageId,
      metadataJson: JSON.stringify({
        name: args.request.name,
        version: args.request.version,
        family: before.pkg.family,
        displayName: before.pkg.displayName,
        changelog: args.request.manualOverrideReason,
        manualOverrideReason: args.request.manualOverrideReason,
        tags: [args.request.version.includes("-") ? "beta" : "latest"],
      }),
    });
    // The insertion owner rechecks authority and original outcome after archive
    // preparation, and atomically binds the pending release to its new attempt.
    const payload: ServerPackagePublishRequest = JSON.parse(prepared.payloadJson);
    try {
      const manifest = payload.files.find((file) => file.path === "package.json");
      const manifestBlob = manifest
        ? await ctx.storage.get(manifest.storageId as Id<"_storage">)
        : null;
      const packageJson: unknown = manifestBlob ? JSON.parse(await manifestBlob.text()) : undefined;
      if (
        !packageJson ||
        typeof packageJson !== "object" ||
        !("name" in packageJson) ||
        packageJson.name !== args.request.name ||
        !("version" in packageJson) ||
        packageJson.version !== args.request.version
      )
        throw new ConvexError("Original package identity does not match the retained archive");
      const repository =
        packageJson && typeof packageJson === "object" && "repository" in packageJson
          ? packageJson.repository
          : undefined;
      const directory =
        repository && typeof repository === "object" && "directory" in repository
          ? repository.directory
          : undefined;
      if (directory !== undefined && directory !== args.request.sourcePath)
        throw new ConvexError(
          "Original package source directory does not match the retained archive",
        );
      const repo = before.token.candidateRepository ?? before.token.repository;
      payload.source = {
        kind: "github",
        repo,
        commit: before.token.candidateSha!,
        ref: before.token.ref,
        path: args.request.sourcePath,
        url: `https://github.com/${repo}/tree/${before.token.candidateSha}/${args.request.sourcePath}`,
        importedAt: Date.now(),
      };
    } catch (error) {
      await Promise.allSettled(prepared.requestStorageIds.map((id) => ctx.storage.delete(id)));
      throw error;
    }
    await ctx.runAction(publishRef, {
      actorUserId: args.actorUserId,
      payload,
      requestStorageIds: prepared.requestStorageIds,
      submissionRecovery: binding,
      requireSecurityChecks: true,
    });
    const after = await ctx.runQuery(contextRef, { ...args, now: Date.now() });
    if (!after.existing) throw new ConvexError("Submission recovery receipt was not recorded");
    return result(after.existing, after.token._id, false);
  },
});
