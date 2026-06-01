import { ConvexError, v } from "convex/values";
import { unzipSync } from "fflate";
import semver from "semver";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./functions";
import { requireUserFromAction, requireUser } from "./lib/access";
import {
  buildGitHubAppInstallUrl,
  createGitHubAppJwt,
  deriveSlugFromCandidatePath,
  hashGitHubAppState,
  isPathUnderAnyRoot,
  normalizeGitHubRepoFullName,
  normalizeGitHubSyncRef,
  normalizeGitHubSyncRoots,
  signGitHubAppState,
  verifyGitHubAppState,
  verifyGitHubWebhookSignature,
} from "./lib/githubAppSync";
import {
  computeDefaultSelectedPaths,
  detectGitHubImportCandidates,
  listTextFilesUnderCandidate,
  normalizeRepoPath,
  stripGitHubZipRoot,
  suggestDisplayName,
  suggestVersion,
  type ZipEntryMap,
} from "./lib/githubImport";
import { requirePublisherRole } from "./lib/publishers";
import { publishVersionForUser } from "./lib/skillPublish";
import { hashSkillFiles, isMacJunkPath, sanitizePath } from "./lib/skills";

const SETUP_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 80 * 1024 * 1024;
const MAX_FILE_COUNT = 7_500;
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SELECTED_BYTES = 50 * 1024 * 1024;
const MAX_CANDIDATES_PER_SYNC = 100;
const SYNC_JOB_RETRY_DELAY_MS = 30 * 1000;
const SYNC_JOB_RUNNING_STALE_MS = 20 * 60 * 1000;

const syncModeValidator = v.union(v.literal("discover"), v.literal("mapped"));

type GitHubInstallationResponse = {
  id?: unknown;
  account?: { login?: unknown; id?: unknown; type?: unknown };
};

type GitHubInstallationRepository = {
  id?: unknown;
  full_name?: unknown;
  default_branch?: unknown;
};

type GitHubInstallationRepositoriesResponse = {
  repositories?: GitHubInstallationRepository[];
};

type SyncCounts = Doc<"githubSkillSyncJobs">["counts"];

export const beginPublisherInstall = action({
  args: {
    publisherId: v.id("publishers"),
    targetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUserFromAction(ctx);
    const appSlug = getRequiredEnv("GITHUB_APP_SLUG");
    const stateSecret = getGitHubAppStateSecret();
    const nonce = randomHex(16);
    const expiresAt = Date.now() + SETUP_STATE_TTL_MS;
    const state = await signGitHubAppState(
      {
        publisherId: args.publisherId,
        requestedByUserId: userId,
        nonce,
        targetAccountId: args.targetId ? normalizeIdString(args.targetId, "target id") : undefined,
        exp: expiresAt,
      },
      stateSecret,
    );
    const stateHash = await hashGitHubAppState(state);

    await ctx.runMutation(internal.githubApp.createSetupStateInternal, {
      publisherId: args.publisherId,
      requestedByUserId: userId,
      stateHash,
      nonce,
      expiresAt,
    });

    return {
      state,
      expiresAt,
      url: buildGitHubAppInstallUrl({
        appSlug,
        state,
        targetId: args.targetId,
      }),
    };
  },
});

export const completePublisherInstall: ReturnType<typeof action> = action({
  args: {
    state: v.string(),
    installationId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    publisherId: Id<"publishers">;
    installationId: string;
    repositories: Array<{ repositoryId: Id<"publisherGitHubRepositories">; repoFullName: string }>;
  }> => {
    const { userId } = await requireUserFromAction(ctx);
    const stateSecret = getGitHubAppStateSecret();
    const payload = await verifyGitHubAppState(args.state, stateSecret);
    if (payload.requestedByUserId !== userId) {
      throw new ConvexError("GitHub setup state does not match the current user");
    }
    const stateHash = await hashGitHubAppState(args.state);
    const setup = (await ctx.runMutation(internal.githubApp.consumeSetupStateInternal, {
      stateHash,
      publisherId: payload.publisherId as Id<"publishers">,
      requestedByUserId: userId,
      nonce: payload.nonce,
      consume: false,
    })) as { publisherId: Id<"publishers">; requestedByUserId: Id<"users"> };

    const appJwt = await createAppJwt();
    const installation = await fetchGitHubInstallation(args.installationId, appJwt);
    const installationAccountId = normalizeIdString(
      installation.account?.id,
      "installation account id",
    );
    const installationAccountType = requireAccountType(installation.account?.type);
    const callerGitHubAccountId = (await ctx.runQuery(
      internal.githubIdentity.getGitHubProviderAccountIdInternal,
      { userId },
    )) as string | null;
    const installationClaim = (await ctx.runQuery(internal.githubApp.getInstallationClaimInternal, {
      installationId: args.installationId,
    })) as Doc<"githubAppInstallationClaims"> | null;
    assertInstallationMatchesSetup({
      installationAccountId,
      installationAccountType,
      targetAccountId: payload.targetAccountId,
      callerGitHubAccountId,
      installationClaim,
    });
    const repositories = await fetchGitHubInstallationRepositories(args.installationId, appJwt);

    await ctx.runMutation(internal.githubApp.consumeSetupStateInternal, {
      stateHash,
      publisherId: setup.publisherId,
      requestedByUserId: setup.requestedByUserId,
      nonce: payload.nonce,
    });

    const result: {
      ok: boolean;
      publisherId: Id<"publishers">;
      installationId: string;
      repositories: Array<{
        repositoryId: Id<"publisherGitHubRepositories">;
        repoFullName: string;
      }>;
    } = await ctx.runMutation(internal.githubApp.upsertPublisherInstallationInternal, {
      publisherId: setup.publisherId,
      linkedByUserId: setup.requestedByUserId,
      installationId: normalizeIdString(installation.id, "installation id"),
      accountLogin: requireString(installation.account?.login, "installation account login"),
      accountId: installationAccountId,
      accountType: installationAccountType,
      repositories: repositories.map((repo) => ({
        repoFullName: requireString(repo.full_name, "repository full_name"),
        repoId: normalizeIdString(repo.id, "repository id"),
        defaultBranch: requireString(repo.default_branch, "repository default_branch"),
      })),
    });

    return result;
  },
});

export const listPublisherRepositories = query({
  args: { publisherId: v.id("publishers") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    await requirePublisherRole(ctx, {
      publisherId: args.publisherId,
      userId,
      allowed: ["admin"],
    });
    const repos = await ctx.db
      .query("publisherGitHubRepositories")
      .withIndex("by_publisher", (q) => q.eq("publisherId", args.publisherId))
      .collect();
    const links = await ctx.db
      .query("skillSourceLinks")
      .withIndex("by_publisher", (q) => q.eq("publisherId", args.publisherId))
      .collect();
    const linkCounts = new Map<Id<"publisherGitHubRepositories">, number>();
    for (const link of links) {
      if (link.status === "disabled") continue;
      linkCounts.set(link.repositoryId, (linkCounts.get(link.repositoryId) ?? 0) + 1);
    }
    return repos
      .filter((repo) => !repo.deletedAt)
      .map((repo) => ({
        ...repo,
        sourceLinkCount: linkCounts.get(repo._id) ?? 0,
      }))
      .sort((a, b) => a.repoFullName.localeCompare(b.repoFullName));
  },
});

export const updateRepositorySyncSettings = mutation({
  args: {
    repositoryId: v.id("publisherGitHubRepositories"),
    syncRef: v.optional(v.string()),
    syncRoots: v.optional(v.array(v.string())),
    mode: v.optional(syncModeValidator),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const repo = await ctx.db.get(args.repositoryId);
    if (!repo || repo.deletedAt) throw new ConvexError("GitHub repository link not found");
    await requirePublisherRole(ctx, {
      publisherId: repo.publisherId,
      userId,
      allowed: ["admin"],
    });
    const patch: Partial<Doc<"publisherGitHubRepositories">> = {
      updatedAt: Date.now(),
    };
    if (args.syncRef !== undefined) {
      patch.syncRef = normalizeGitHubSyncRef(args.syncRef, repo.defaultBranch);
    }
    if (args.syncRoots !== undefined) {
      patch.syncRoots = normalizeGitHubSyncRoots(args.syncRoots);
    }
    if (args.mode !== undefined) patch.mode = args.mode;
    if (args.enabled !== undefined) patch.enabled = args.enabled;
    await ctx.db.patch(repo._id, patch);
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "github_app.repository.update",
      targetType: "publisherGitHubRepository",
      targetId: repo._id,
      metadata: { patch },
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export const queueRepositorySync = mutation({
  args: {
    repositoryId: v.id("publisherGitHubRepositories"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const repo = await ctx.db.get(args.repositoryId);
    if (!repo || repo.deletedAt || !repo.enabled) {
      throw new ConvexError("GitHub repository link not found");
    }
    await requirePublisherRole(ctx, {
      publisherId: repo.publisherId,
      userId,
      allowed: ["admin"],
    });
    const jobId = await queueRepositorySyncInternal(ctx, {
      repo,
      commit: "",
      ref: repo.syncRef,
      reason: "manual",
      requestedByUserId: userId,
    });
    if (!jobId) throw new ConvexError("Could not queue GitHub sync");
    await ctx.scheduler.runAfter(0, internal.githubApp.runRepositorySyncInternal, { jobId });
    return { ok: true, jobId };
  },
});

export const adoptSkillSourceLink = mutation({
  args: {
    repositoryId: v.id("publisherGitHubRepositories"),
    path: v.string(),
    slug: v.string(),
    skillId: v.id("skills"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const repo = await ctx.db.get(args.repositoryId);
    const skill = await ctx.db.get(args.skillId);
    if (!repo || repo.deletedAt) throw new ConvexError("GitHub repository link not found");
    if (!skill || skill.softDeletedAt) throw new ConvexError("Skill not found");
    await requirePublisherRole(ctx, {
      publisherId: repo.publisherId,
      userId,
      allowed: ["admin"],
    });
    if (skill.ownerPublisherId !== repo.publisherId) {
      throw new ConvexError("Only skills owned by this publisher can be adopted");
    }
    const slug = normalizeRepoPath(args.slug) || args.slug.trim().toLowerCase();
    if (skill.slug !== slug) throw new ConvexError("Source link slug must match the skill slug");
    const path = normalizeRepoPath(args.path);
    const existing = await ctx.db
      .query("skillSourceLinks")
      .withIndex("by_repository_path", (q) => q.eq("repositoryId", repo._id).eq("path", path))
      .unique();
    if (existing?.skillId && existing.skillId !== skill._id) {
      throw new ConvexError("Source path is already linked to a different skill");
    }
    const skillLinks = await ctx.db
      .query("skillSourceLinks")
      .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
      .collect();
    if (skillLinks.some((link) => link.status !== "disabled" && link._id !== existing?._id)) {
      throw new ConvexError("Skill already has an active source link");
    }
    const now = Date.now();
    const fields = {
      publisherId: repo.publisherId,
      skillId: skill._id,
      repositoryId: repo._id,
      repoFullName: repo.repoFullName,
      repoId: repo.repoId,
      path,
      slug: skill.slug,
      readmePath: path ? `${path}/SKILL.md` : "SKILL.md",
      status: "active" as const,
      conflictReason: undefined,
      createdByUserId: userId,
      disabledAt: undefined,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("skillSourceLinks", { ...fields, createdAt: now });
    }
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "github_app.skill_source.adopt",
      targetType: "skill",
      targetId: skill._id,
      metadata: { repositoryId: repo._id, path },
      createdAt: now,
    });
    return { ok: true };
  },
});

export const disableSkillSourceLink = mutation({
  args: { sourceLinkId: v.id("skillSourceLinks") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const link = await ctx.db.get(args.sourceLinkId);
    if (!link) throw new ConvexError("Source link not found");
    await requirePublisherRole(ctx, {
      publisherId: link.publisherId,
      userId,
      allowed: ["admin"],
    });
    await ctx.db.patch(link._id, {
      status: "disabled",
      disabledAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "github_app.skill_source.disable",
      targetType: "skillSourceLink",
      targetId: link._id,
      metadata: { skillId: link.skillId, repositoryId: link.repositoryId, path: link.path },
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export const githubWebhookHttp = httpAction(async (ctx, req) => {
  const body = await req.arrayBuffer();
  const verification = await verifyGitHubWebhookSignature({
    body,
    signatureHeader: req.headers.get("x-hub-signature-256"),
    secret: process.env.GITHUB_APP_WEBHOOK_SECRET,
  });
  if (!verification.ok) {
    return new Response(`GitHub webhook rejected: ${verification.reason}`, { status: 401 });
  }

  const event = req.headers.get("x-github-event")?.trim() || "";
  const deliveryId = req.headers.get("x-github-delivery")?.trim() || "";
  if (!deliveryId) return new Response("Missing GitHub delivery id", { status: 400 });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const installationId = normalizeOptionalId(
    (payload.installation as { id?: unknown } | undefined)?.id,
  );
  const installationAccountId = normalizeOptionalId(
    (payload.installation as { account?: { id?: unknown } } | undefined)?.account?.id,
  );
  const senderAccountId = normalizeOptionalId((payload.sender as { id?: unknown } | undefined)?.id);
  const repo = payload.repository as
    | { id?: unknown; full_name?: unknown; default_branch?: unknown }
    | undefined;
  const repoId = normalizeOptionalId(repo?.id);

  const dedupe = (await ctx.runMutation(internal.githubApp.claimWebhookDeliveryInternal, {
    deliveryId,
    event,
    installationId,
    repoId,
  })) as { duplicate: boolean };
  if (dedupe.duplicate) return new Response("Duplicate", { status: 202 });

  try {
    if (event === "push") {
      const ref = typeof payload.ref === "string" ? payload.ref : "";
      const commit = typeof payload.after === "string" ? payload.after : "";
      await ctx.runMutation(internal.githubApp.queuePushSyncsInternal, {
        installationId: installationId ?? "",
        repoId: repoId ?? "",
        repoFullName: typeof repo?.full_name === "string" ? repo.full_name : "",
        defaultBranch: typeof repo?.default_branch === "string" ? repo.default_branch : "",
        ref,
        commit,
      });
    } else if (event === "installation" || event === "installation_repositories") {
      await ctx.runMutation(internal.githubApp.recordInstallationClaimInternal, {
        installationId: installationId ?? "",
        accountId: installationAccountId ?? "",
        senderAccountId: senderAccountId ?? "",
        event,
      });
      const webhookAction = typeof payload.action === "string" ? payload.action : "";
      const addedRepoIds = Array.isArray(payload.added_repositories)
        ? payload.added_repositories
            .map((added) => normalizeOptionalId((added as { id?: unknown }).id))
            .filter((id): id is string => Boolean(id))
        : [];
      const removedRepoIds = Array.isArray(payload.removed_repositories)
        ? payload.removed_repositories
            .map((removed) => normalizeOptionalId((removed as { id?: unknown }).id))
            .filter((id): id is string => Boolean(id))
        : [];
      if (addedRepoIds.length > 0 && installationId) {
        const appJwt = await createAppJwt();
        const repositories = await fetchGitHubInstallationRepositories(installationId, appJwt);
        const addedRepoIdSet = new Set(addedRepoIds);
        await ctx.runMutation(internal.githubApp.upsertInstallationRepositoriesInternal, {
          installationId,
          repositories: repositories
            .filter((addedRepo) => {
              const id = normalizeOptionalId(addedRepo.id);
              return id ? addedRepoIdSet.has(id) : false;
            })
            .map((addedRepo) => ({
              repoFullName: requireString(addedRepo.full_name, "repository full_name"),
              repoId: normalizeIdString(addedRepo.id, "repository id"),
              defaultBranch: requireString(addedRepo.default_branch, "repository default_branch"),
            })),
        });
      }
      if (
        event === "installation" &&
        (webhookAction === "deleted" ||
          webhookAction === "suspend" ||
          webhookAction === "suspended")
      ) {
        await ctx.runMutation(internal.githubApp.disableInstallationRepositoriesInternal, {
          installationId: installationId ?? "",
          repoIds: [],
          reason: `installation.${webhookAction}`,
        });
      } else if (removedRepoIds.length > 0) {
        await ctx.runMutation(internal.githubApp.disableInstallationRepositoriesInternal, {
          installationId: installationId ?? "",
          repoIds: removedRepoIds,
          reason: "installation_repositories.removed",
        });
      }
      await ctx.runMutation(internal.githubApp.markInstallationChangedInternal, {
        installationId: installationId ?? "",
      });
    } else if (event === "repository") {
      await ctx.runMutation(internal.githubApp.markRepositoryChangedInternal, {
        installationId: installationId ?? "",
        repoId: repoId ?? "",
        repoFullName: typeof repo?.full_name === "string" ? repo.full_name : "",
        defaultBranch: typeof repo?.default_branch === "string" ? repo.default_branch : "",
      });
    }
  } catch (error) {
    await ctx.runMutation(internal.githubApp.markWebhookDeliveryFailedInternal, {
      deliveryId,
      error: toErrorMessage(error),
    });
    return new Response("Webhook processing failed", { status: 500 });
  }

  await ctx.runMutation(internal.githubApp.markWebhookDeliveryProcessedInternal, { deliveryId });
  return new Response("Accepted", { status: 202 });
});

export const createSetupStateInternal = internalMutation({
  args: {
    publisherId: v.id("publishers"),
    requestedByUserId: v.id("users"),
    stateHash: v.string(),
    nonce: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePublisherRole(ctx, {
      publisherId: args.publisherId,
      userId: args.requestedByUserId,
      allowed: ["admin"],
    });
    await ctx.db.insert("githubAppSetupStates", {
      stateHash: args.stateHash,
      publisherId: args.publisherId,
      requestedByUserId: args.requestedByUserId,
      nonce: args.nonce,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
  },
});

export const consumeSetupStateInternal = internalMutation({
  args: {
    stateHash: v.string(),
    publisherId: v.id("publishers"),
    requestedByUserId: v.id("users"),
    nonce: v.string(),
    consume: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("githubAppSetupStates")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (!state || state.consumedAt) throw new ConvexError("GitHub setup state not found");
    if (state.expiresAt < Date.now()) throw new ConvexError("GitHub setup state expired");
    if (
      state.publisherId !== args.publisherId ||
      state.requestedByUserId !== args.requestedByUserId ||
      state.nonce !== args.nonce
    ) {
      throw new ConvexError("GitHub setup state mismatch");
    }
    await requirePublisherRole(ctx, {
      publisherId: state.publisherId,
      userId: state.requestedByUserId,
      allowed: ["admin"],
    });
    if (args.consume !== false) {
      await ctx.db.patch(state._id, { consumedAt: Date.now() });
    }
    return {
      publisherId: state.publisherId,
      requestedByUserId: state.requestedByUserId,
    };
  },
});

export const upsertPublisherInstallationInternal = internalMutation({
  args: {
    publisherId: v.id("publishers"),
    linkedByUserId: v.id("users"),
    installationId: v.string(),
    accountLogin: v.string(),
    accountId: v.string(),
    accountType: v.union(v.literal("User"), v.literal("Organization")),
    repositories: v.array(
      v.object({
        repoFullName: v.string(),
        repoId: v.string(),
        defaultBranch: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requirePublisherRole(ctx, {
      publisherId: args.publisherId,
      userId: args.linkedByUserId,
      allowed: ["admin"],
    });
    const now = Date.now();
    let installation = await ctx.db
      .query("githubAppInstallations")
      .withIndex("by_installation_id", (q) => q.eq("installationId", args.installationId))
      .unique();
    if (installation) {
      await ctx.db.patch(installation._id, {
        accountLogin: args.accountLogin,
        accountId: args.accountId,
        accountType: args.accountType,
        deletedAt: undefined,
        suspendedAt: undefined,
        updatedAt: now,
      });
    } else {
      const installationId = await ctx.db.insert("githubAppInstallations", {
        installationId: args.installationId,
        accountLogin: args.accountLogin,
        accountId: args.accountId,
        accountType: args.accountType,
        createdByUserId: args.linkedByUserId,
        createdAt: now,
        updatedAt: now,
      });
      installation = await ctx.db.get(installationId);
    }
    if (!installation) throw new ConvexError("GitHub installation could not be stored");

    let link = await ctx.db
      .query("publisherGitHubLinks")
      .withIndex("by_publisher_installation_id", (q) =>
        q.eq("publisherId", args.publisherId).eq("installationId", args.installationId),
      )
      .unique();
    if (link) {
      await ctx.db.patch(link._id, {
        githubAppInstallationId: installation._id,
        linkedByUserId: args.linkedByUserId,
        deletedAt: undefined,
        updatedAt: now,
      });
    } else {
      const linkId = await ctx.db.insert("publisherGitHubLinks", {
        publisherId: args.publisherId,
        installationId: args.installationId,
        githubAppInstallationId: installation._id,
        linkedByUserId: args.linkedByUserId,
        createdAt: now,
        updatedAt: now,
      });
      link = await ctx.db.get(linkId);
    }
    if (!link) throw new ConvexError("GitHub link could not be stored");

    const repos = [];
    for (const repo of args.repositories) {
      const normalizedName = normalizeGitHubRepoFullName(repo.repoFullName);
      if (!normalizedName) continue;
      const existingRepos = await ctx.db
        .query("publisherGitHubRepositories")
        .withIndex("by_installation_repo_id", (q) =>
          q.eq("installationId", args.installationId).eq("repoId", repo.repoId),
        )
        .collect();
      const existing = existingRepos.find(
        (candidate) => candidate.publisherId === args.publisherId,
      );
      if (
        existingRepos.some(
          (candidate) => candidate.publisherId !== args.publisherId && !candidate.deletedAt,
        )
      ) {
        throw new ConvexError("GitHub repository is already linked to another publisher");
      }
      const fields = {
        publisherId: args.publisherId,
        githubLinkId: link._id,
        installationId: args.installationId,
        repoFullName: normalizedName,
        repoId: repo.repoId,
        defaultBranch: repo.defaultBranch,
        updatedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, {
          ...fields,
          deletedAt: undefined,
        });
        await syncSourceLinkRepoFullName(ctx, {
          repositoryId: existing._id,
          repoFullName: normalizedName,
          now,
        });
        repos.push({ repositoryId: existing._id, repoFullName: normalizedName });
      } else {
        const repositoryId = await ctx.db.insert("publisherGitHubRepositories", {
          ...fields,
          syncRef: repo.defaultBranch,
          syncRoots: [""],
          mode: "discover",
          enabled: false,
          lastSyncStatus: "idle",
          createdAt: now,
        });
        repos.push({ repositoryId, repoFullName: normalizedName });
      }
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: args.linkedByUserId,
      action: "github_app.installation.link",
      targetType: "publisher",
      targetId: args.publisherId,
      metadata: {
        installationId: args.installationId,
        accountLogin: args.accountLogin,
        repositories: repos.length,
      },
      createdAt: now,
    });

    return {
      ok: true,
      publisherId: args.publisherId,
      installationId: args.installationId,
      repositories: repos,
    };
  },
});

export const upsertInstallationRepositoriesInternal = internalMutation({
  args: {
    installationId: v.string(),
    repositories: v.array(
      v.object({
        repoFullName: v.string(),
        repoId: v.string(),
        defaultBranch: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (!args.installationId) return { upserted: 0 };
    const links = await ctx.db
      .query("publisherGitHubLinks")
      .withIndex("by_installation_id", (q) => q.eq("installationId", args.installationId))
      .collect();
    const activeLinks = links.filter((link) => !link.deletedAt);
    const now = Date.now();
    let upserted = 0;

    for (const link of activeLinks) {
      for (const repo of args.repositories) {
        const normalizedName = normalizeGitHubRepoFullName(repo.repoFullName);
        if (!normalizedName) continue;
        const existingRepos = await ctx.db
          .query("publisherGitHubRepositories")
          .withIndex("by_installation_repo_id", (q) =>
            q.eq("installationId", args.installationId).eq("repoId", repo.repoId),
          )
          .collect();
        const existing = existingRepos.find(
          (candidate) => candidate.publisherId === link.publisherId,
        );
        if (
          existingRepos.some(
            (candidate) => candidate.publisherId !== link.publisherId && !candidate.deletedAt,
          )
        ) {
          continue;
        }
        const fields = {
          publisherId: link.publisherId,
          githubLinkId: link._id,
          installationId: args.installationId,
          repoFullName: normalizedName,
          repoId: repo.repoId,
          defaultBranch: repo.defaultBranch,
          updatedAt: now,
        };
        if (existing) {
          await ctx.db.patch(existing._id, {
            ...fields,
            deletedAt: undefined,
          });
          await syncSourceLinkRepoFullName(ctx, {
            repositoryId: existing._id,
            repoFullName: normalizedName,
            now,
          });
        } else {
          await ctx.db.insert("publisherGitHubRepositories", {
            ...fields,
            syncRef: repo.defaultBranch,
            syncRoots: [""],
            mode: "discover",
            enabled: false,
            lastSyncStatus: "idle",
            createdAt: now,
          });
        }
        upserted += 1;
      }
    }
    return { upserted };
  },
});

export const claimWebhookDeliveryInternal = internalMutation({
  args: {
    deliveryId: v.string(),
    event: v.string(),
    installationId: v.optional(v.string()),
    repoId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("githubWebhookDeliveries")
      .withIndex("by_delivery_id", (q) => q.eq("deliveryId", args.deliveryId))
      .unique();
    if (existing?.status === "processed") return { duplicate: true };
    if (existing?.status === "processing" && existing.updatedAt > now - 5 * 60 * 1000) {
      return { duplicate: true };
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        event: args.event,
        status: "processing",
        installationId: args.installationId || undefined,
        repoId: args.repoId || undefined,
        error: undefined,
        updatedAt: now,
      });
      return { duplicate: false };
    }
    await ctx.db.insert("githubWebhookDeliveries", {
      deliveryId: args.deliveryId,
      event: args.event,
      status: "processing",
      installationId: args.installationId || undefined,
      repoId: args.repoId || undefined,
      receivedAt: now,
      updatedAt: now,
    });
    return { duplicate: false };
  },
});

export const markWebhookDeliveryProcessedInternal = internalMutation({
  args: { deliveryId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubWebhookDeliveries")
      .withIndex("by_delivery_id", (q) => q.eq("deliveryId", args.deliveryId))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      status: "processed",
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const markWebhookDeliveryFailedInternal = internalMutation({
  args: { deliveryId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubWebhookDeliveries")
      .withIndex("by_delivery_id", (q) => q.eq("deliveryId", args.deliveryId))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      status: "failed",
      error: args.error.slice(0, 1000),
      updatedAt: Date.now(),
    });
  },
});

export const recordInstallationClaimInternal = internalMutation({
  args: {
    installationId: v.string(),
    accountId: v.string(),
    senderAccountId: v.string(),
    event: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.installationId || !args.accountId || !args.senderAccountId) return;
    const now = Date.now();
    const existing = await ctx.db
      .query("githubAppInstallationClaims")
      .withIndex("by_installation_id", (q) => q.eq("installationId", args.installationId))
      .unique();
    const fields = {
      accountId: args.accountId,
      senderAccountId: args.senderAccountId,
      event: args.event,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("githubAppInstallationClaims", {
        installationId: args.installationId,
        ...fields,
        receivedAt: now,
      });
    }
  },
});

export const getInstallationClaimInternal = internalQuery({
  args: { installationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("githubAppInstallationClaims")
      .withIndex("by_installation_id", (q) => q.eq("installationId", args.installationId))
      .unique();
  },
});

export const queuePushSyncsInternal = internalMutation({
  args: {
    installationId: v.string(),
    repoId: v.string(),
    repoFullName: v.string(),
    defaultBranch: v.string(),
    ref: v.string(),
    commit: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.installationId || !args.repoId || !isSyncableCommit(args.commit)) {
      return { queued: 0 };
    }
    const branch = args.ref.replace(/^refs\/heads\//, "");
    const repos = await ctx.db
      .query("publisherGitHubRepositories")
      .withIndex("by_installation_repo_id", (q) =>
        q.eq("installationId", args.installationId).eq("repoId", args.repoId),
      )
      .collect();
    let queued = 0;
    for (const repo of repos) {
      if (repo.deletedAt || !repo.enabled) continue;
      if (repo.syncRef !== branch && repo.syncRef !== args.ref) continue;
      const repoFullName = normalizeGitHubRepoFullName(args.repoFullName) ?? repo.repoFullName;
      if (args.repoFullName || args.defaultBranch) {
        await ctx.db.patch(repo._id, {
          repoFullName,
          defaultBranch: args.defaultBranch || repo.defaultBranch,
          updatedAt: Date.now(),
        });
        await syncSourceLinkRepoFullName(ctx, {
          repositoryId: repo._id,
          repoFullName,
          now: Date.now(),
        });
      }
      const jobId = await queueRepositorySyncInternal(ctx, {
        repo: { ...repo, repoFullName },
        commit: args.commit.toLowerCase(),
        ref: branch,
        reason: "push",
      });
      if (jobId) {
        queued += 1;
        await ctx.scheduler.runAfter(0, internal.githubApp.runRepositorySyncInternal, { jobId });
      }
    }
    return { queued };
  },
});

export const markInstallationChangedInternal = internalMutation({
  args: { installationId: v.string() },
  handler: async (ctx, args) => {
    if (!args.installationId) return;
    const links = await ctx.db
      .query("publisherGitHubLinks")
      .withIndex("by_installation_id", (q) => q.eq("installationId", args.installationId))
      .collect();
    const now = Date.now();
    for (const link of links) {
      await ctx.db.patch(link._id, { updatedAt: now });
    }
  },
});

export const markRepositoryChangedInternal = internalMutation({
  args: {
    installationId: v.string(),
    repoId: v.string(),
    repoFullName: v.string(),
    defaultBranch: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.installationId || !args.repoId) return;
    const repos = await ctx.db
      .query("publisherGitHubRepositories")
      .withIndex("by_installation_repo_id", (q) =>
        q.eq("installationId", args.installationId).eq("repoId", args.repoId),
      )
      .collect();
    const now = Date.now();
    for (const repo of repos) {
      const repoFullName = normalizeGitHubRepoFullName(args.repoFullName) ?? repo.repoFullName;
      await ctx.db.patch(repo._id, {
        repoFullName,
        defaultBranch: args.defaultBranch || repo.defaultBranch,
        updatedAt: now,
      });
      await syncSourceLinkRepoFullName(ctx, {
        repositoryId: repo._id,
        repoFullName,
        now,
      });
    }
  },
});

export const disableInstallationRepositoriesInternal = internalMutation({
  args: {
    installationId: v.string(),
    repoIds: v.array(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.installationId) return { disabled: 0 };
    const repoIdSet = new Set(args.repoIds);
    const repos =
      repoIdSet.size > 0
        ? (
            await Promise.all(
              Array.from(repoIdSet, async (repoId) =>
                ctx.db
                  .query("publisherGitHubRepositories")
                  .withIndex("by_installation_repo_id", (q) =>
                    q.eq("installationId", args.installationId).eq("repoId", repoId),
                  )
                  .collect(),
              ),
            )
          ).flat()
        : await ctx.db
            .query("publisherGitHubRepositories")
            .withIndex("by_installation_id", (q) => q.eq("installationId", args.installationId))
            .collect();
    const now = Date.now();
    let disabled = 0;
    for (const repo of repos) {
      if (repo.deletedAt) continue;
      await ctx.db.patch(repo._id, {
        enabled: false,
        deletedAt: now,
        lastSyncStatus: "failed",
        lastSyncError: args.reason,
        updatedAt: now,
      });
      const links = await ctx.db
        .query("skillSourceLinks")
        .withIndex("by_repository", (q) => q.eq("repositoryId", repo._id))
        .collect();
      for (const link of links) {
        if (link.status === "disabled") continue;
        await ctx.db.patch(link._id, {
          status: "disabled",
          conflictReason: args.reason,
          disabledAt: now,
          updatedAt: now,
        });
      }
      disabled += 1;
    }
    return { disabled };
  },
});

export const runRepositorySyncInternal = internalAction({
  args: { jobId: v.id("githubSkillSyncJobs") },
  handler: async (ctx, args) => {
    const claim = (await ctx.runMutation(internal.githubApp.claimSyncJobInternal, {
      jobId: args.jobId,
    })) as
      | { ok: false }
      | {
          ok: true;
          job: Doc<"githubSkillSyncJobs">;
          repo: Doc<"publisherGitHubRepositories">;
          linkedByUserId: Id<"users">;
        };
    if (!claim.ok) return { ok: false, reason: "not-queued" };

    const { job, repo, linkedByUserId } = claim;
    const counts: SyncCounts = {
      discovered: 0,
      published: 0,
      skipped: 0,
      conflicted: 0,
      missing: 0,
    };
    try {
      const token = await createInstallationToken(repo.installationId);
      const commit =
        job.commit || (await resolveGitHubRefCommit(repo.repoFullName, job.ref, token));
      const zipBytes = await fetchGitHubArchiveBytes(repo.repoFullName, commit, token);
      const entries = stripGitHubZipRoot(unzipToEntries(zipBytes));
      const allCandidates = detectGitHubImportCandidates(entries).filter((candidate) =>
        isPathUnderAnyRoot(candidate.path, repo.syncRoots),
      );
      const candidates = allCandidates.slice(0, MAX_CANDIDATES_PER_SYNC);
      counts.discovered = allCandidates.length;

      const activeBefore = (await ctx.runMutation(
        internal.githubApp.markMissingSourceLinksInternal,
        {
          repositoryId: repo._id,
          discoveredPaths: allCandidates.map((candidate) => candidate.path),
        },
      )) as { missing: number };
      counts.missing = activeBefore.missing;

      const sourceLinks = (await ctx.runMutation(
        internal.githubApp.prepareSourceLinksForSyncInternal,
        {
          repositoryId: repo._id,
          candidates: candidates.map((candidate) => ({
            path: candidate.path,
            readmePath: candidate.readmePath,
          })),
        },
      )) as Array<Doc<"skillSourceLinks">>;
      const linksByPath = new Map(sourceLinks.map((link) => [link.path, link]));

      for (const candidate of candidates) {
        let link = linksByPath.get(candidate.path);
        if (repo.mode === "mapped" && !link) {
          counts.skipped += 1;
          continue;
        }
        if (!link) {
          const slug = deriveSlugFromCandidatePath(candidate.path, repo.repoFullName);
          if (!slug) {
            counts.conflicted += 1;
            continue;
          }
          link = (await ctx.runMutation(internal.githubApp.createDiscoveredSourceLinkInternal, {
            repositoryId: repo._id,
            path: candidate.path,
            readmePath: candidate.readmePath,
            slug,
            createdByUserId: linkedByUserId,
          })) as Doc<"skillSourceLinks">;
        }
        if (link.status === "disabled") {
          counts.skipped += 1;
          continue;
        }

        const files = listTextFilesUnderCandidate(entries, candidate.path);
        const selected = computeDefaultSelectedPaths({ candidate, files });
        const preparedFiles = await prepareSelectedCandidateFiles({
          files,
          selectedPaths: selected,
          candidatePath: candidate.path,
        });
        const fingerprint = await hashSkillFiles(
          preparedFiles.map((file) => ({ path: file.path, sha256: file.sha256 })),
        );

        const readiness = (await ctx.runMutation(
          internal.githubApp.prepareSourceLinkPublishInternal,
          {
            sourceLinkId: link._id,
            fingerprint,
          },
        )) as
          | { ok: false; status: "conflict"; reason: string }
          | { ok: true; slug: string; displayName: string; version: string };
        if (!readiness.ok) {
          counts.conflicted += 1;
          continue;
        }
        if (link.lastFingerprint === fingerprint) {
          await ctx.runMutation(internal.githubApp.markSourceLinkUnchangedInternal, {
            sourceLinkId: link._id,
            commit,
            fingerprint,
          });
          counts.skipped += 1;
          continue;
        }
        const storedFiles = await storePreparedCandidateFiles(ctx, preparedFiles);

        const sourceProvenance = {
          kind: "github" as const,
          url: `https://github.com/${repo.repoFullName}/tree/${commit}/${candidate.path}`.replace(
            /\/$/,
            "",
          ),
          repo: repo.repoFullName,
          ref: job.ref,
          commit,
          path: candidate.path,
          importedAt: Date.now(),
        };
        try {
          const result = await publishVersionForUser(
            ctx,
            linkedByUserId,
            {
              slug: readiness.slug,
              displayName: readiness.displayName || suggestDisplayName(candidate, readiness.slug),
              version: readiness.version,
              changelog: "",
              tags: ["latest"],
              files: storedFiles,
              source: sourceProvenance,
            },
            {
              ownerPublisherId: repo.publisherId,
              sourceProvenance,
              sourceSync: { sourceLinkId: link._id, repositoryId: repo._id, syncJobId: job._id },
              bypassGitHubAccountAge: true,
            },
          );
          await ctx.runMutation(internal.githubApp.markSourceLinkPublishedInternal, {
            sourceLinkId: link._id,
            skillId: result.skillId,
            versionId: result.versionId,
            commit,
            fingerprint,
          });
          counts.published += 1;
        } catch (error) {
          await ctx.runMutation(internal.githubApp.markSourceLinkConflictInternal, {
            sourceLinkId: link._id,
            reason: toErrorMessage(error),
          });
          counts.conflicted += 1;
        }
      }

      await ctx.runMutation(internal.githubApp.finishSyncJobInternal, {
        jobId: job._id,
        status: "succeeded",
        counts,
        commit,
      });
      return { ok: true, counts };
    } catch (error) {
      await ctx.runMutation(internal.githubApp.finishSyncJobInternal, {
        jobId: job._id,
        status: "failed",
        counts,
        error: toErrorMessage(error),
      });
      return { ok: false, error: toErrorMessage(error), counts };
    }
  },
});

export const claimSyncJobInternal = internalMutation({
  args: { jobId: v.id("githubSkillSyncJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "queued") return { ok: false as const };
    if (job.reason === "push") {
      const newerQueued = await ctx.db
        .query("githubSkillSyncJobs")
        .withIndex("by_repository_status", (q) =>
          q.eq("repositoryId", job.repositoryId).eq("status", "queued"),
        )
        .collect();
      if (
        newerQueued.some(
          (candidate) =>
            candidate._id !== job._id &&
            candidate.ref === job.ref &&
            candidate.createdAt > job.createdAt,
        )
      ) {
        await ctx.db.patch(job._id, {
          status: "cancelled",
          finishedAt: Date.now(),
          updatedAt: Date.now(),
          error: "Superseded by a newer push",
        });
        return { ok: false as const };
      }
    }
    const runningJobs = await ctx.db
      .query("githubSkillSyncJobs")
      .withIndex("by_repository_status", (q) =>
        q.eq("repositoryId", job.repositoryId).eq("status", "running"),
      )
      .collect();
    const now = Date.now();
    const activeRunning = runningJobs.filter(
      (runningJob) =>
        !runningJob.startedAt || now - runningJob.startedAt <= SYNC_JOB_RUNNING_STALE_MS,
    );
    if (activeRunning.length > 0) {
      await ctx.db.patch(job._id, { updatedAt: now });
      await ctx.scheduler.runAfter(
        SYNC_JOB_RETRY_DELAY_MS,
        internal.githubApp.runRepositorySyncInternal,
        {
          jobId: job._id,
        },
      );
      return { ok: false as const };
    }
    for (const staleJob of runningJobs) {
      await ctx.db.patch(staleJob._id, {
        status: "failed",
        finishedAt: now,
        updatedAt: now,
        error: "Sync job timed out while holding repository lock",
      });
    }
    const repo = await ctx.db.get(job.repositoryId);
    if (!repo || repo.deletedAt || !repo.enabled) {
      await ctx.db.patch(job._id, {
        status: "cancelled",
        finishedAt: now,
        updatedAt: now,
        error: "Repository link is disabled",
      });
      return { ok: false as const };
    }
    const link = await ctx.db.get(repo.githubLinkId);
    if (!link || link.deletedAt) {
      await ctx.db.patch(job._id, {
        status: "cancelled",
        finishedAt: now,
        updatedAt: now,
        error: "GitHub link is disabled",
      });
      return { ok: false as const };
    }
    await ctx.db.patch(job._id, {
      status: "running",
      startedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(repo._id, {
      lastSyncStatus: "running",
      lastSyncError: undefined,
      updatedAt: now,
    });
    return {
      ok: true as const,
      job: { ...job, status: "running" as const },
      repo,
      linkedByUserId: link.linkedByUserId,
    };
  },
});

export const markMissingSourceLinksInternal = internalMutation({
  args: {
    repositoryId: v.id("publisherGitHubRepositories"),
    discoveredPaths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const discovered = new Set(args.discoveredPaths.map((path) => normalizeRepoPath(path)));
    const links = await ctx.db
      .query("skillSourceLinks")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();
    let missing = 0;
    for (const link of links) {
      if (link.status === "disabled") continue;
      if (discovered.has(link.path)) continue;
      await ctx.db.patch(link._id, {
        status: "missing",
        conflictReason: undefined,
        updatedAt: Date.now(),
      });
      missing += 1;
    }
    return { missing };
  },
});

export const prepareSourceLinksForSyncInternal = internalMutation({
  args: {
    repositoryId: v.id("publisherGitHubRepositories"),
    candidates: v.array(v.object({ path: v.string(), readmePath: v.string() })),
  },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("skillSourceLinks")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();
    const byPath = new Map(links.map((link) => [link.path, link]));
    const out: Doc<"skillSourceLinks">[] = [];
    for (const candidate of args.candidates) {
      const link = byPath.get(normalizeRepoPath(candidate.path));
      if (!link) continue;
      if (link.status === "missing") {
        await ctx.db.patch(link._id, {
          status: "active",
          readmePath: normalizeRepoPath(candidate.readmePath),
          conflictReason: undefined,
          updatedAt: Date.now(),
        });
        out.push({
          ...link,
          status: "active",
          readmePath: normalizeRepoPath(candidate.readmePath),
          conflictReason: undefined,
          updatedAt: Date.now(),
        });
      } else {
        out.push(link);
      }
    }
    return out;
  },
});

export const createDiscoveredSourceLinkInternal = internalMutation({
  args: {
    repositoryId: v.id("publisherGitHubRepositories"),
    path: v.string(),
    readmePath: v.string(),
    slug: v.string(),
    createdByUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repositoryId);
    if (!repo || repo.deletedAt) throw new ConvexError("Repository link not found");
    const path = normalizeRepoPath(args.path);
    const existing = await ctx.db
      .query("skillSourceLinks")
      .withIndex("by_repository_path", (q) => q.eq("repositoryId", repo._id).eq("path", path))
      .unique();
    if (existing) return existing;
    const now = Date.now();
    const linkId = await ctx.db.insert("skillSourceLinks", {
      publisherId: repo.publisherId,
      repositoryId: repo._id,
      repoFullName: repo.repoFullName,
      repoId: repo.repoId,
      path,
      slug: args.slug,
      readmePath: normalizeRepoPath(args.readmePath),
      status: "active",
      createdByUserId: args.createdByUserId,
      createdAt: now,
      updatedAt: now,
    });
    const link = await ctx.db.get(linkId);
    if (!link) throw new ConvexError("Source link could not be created");
    return link;
  },
});

export const prepareSourceLinkPublishInternal = internalMutation({
  args: {
    sourceLinkId: v.id("skillSourceLinks"),
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.sourceLinkId);
    if (!link || link.status === "disabled") {
      return { ok: false as const, status: "conflict" as const, reason: "Source link is disabled" };
    }
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_slug", (q) =>
        q.eq("ownerPublisherId", link.publisherId).eq("slug", link.slug),
      )
      .unique();
    if (existing && !link.skillId) {
      await ctx.db.patch(link._id, {
        status: "conflict",
        conflictReason: "manual skill already uses this slug",
        updatedAt: Date.now(),
      });
      return {
        ok: false as const,
        status: "conflict" as const,
        reason: "manual skill already uses this slug",
      };
    }
    if (existing && link.skillId && existing._id !== link.skillId) {
      await ctx.db.patch(link._id, {
        status: "conflict",
        conflictReason: "slug resolves to a different skill",
        updatedAt: Date.now(),
      });
      return {
        ok: false as const,
        status: "conflict" as const,
        reason: "slug resolves to a different skill",
      };
    }
    const skill = link.skillId ? await ctx.db.get(link.skillId) : existing;
    if (skill?.softDeletedAt) {
      await ctx.db.patch(link._id, {
        status: "conflict",
        conflictReason: "source-managed skill is deleted",
        updatedAt: Date.now(),
      });
      return {
        ok: false as const,
        status: "conflict" as const,
        reason: "source-managed skill is deleted",
      };
    }
    const latestVersion = skill?.latestVersionId ? await ctx.db.get(skill.latestVersionId) : null;
    const version = suggestVersion(latestVersion?.version ?? null);
    if (!semver.valid(version)) throw new ConvexError("Could not derive next semver version");
    return {
      ok: true as const,
      slug: link.slug,
      displayName: skill?.displayName ?? link.slug,
      version,
      fingerprint: args.fingerprint,
    };
  },
});

export const markSourceLinkPublishedInternal = internalMutation({
  args: {
    sourceLinkId: v.id("skillSourceLinks"),
    skillId: v.id("skills"),
    versionId: v.id("skillVersions"),
    commit: v.string(),
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sourceLinkId, {
      skillId: args.skillId,
      status: "active",
      conflictReason: undefined,
      lastSyncedCommit: args.commit,
      lastSyncedVersionId: args.versionId,
      lastFingerprint: args.fingerprint,
      updatedAt: Date.now(),
    });
  },
});

export const markSourceLinkUnchangedInternal = internalMutation({
  args: {
    sourceLinkId: v.id("skillSourceLinks"),
    commit: v.string(),
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sourceLinkId, {
      status: "active",
      conflictReason: undefined,
      lastSyncedCommit: args.commit,
      lastFingerprint: args.fingerprint,
      updatedAt: Date.now(),
    });
  },
});

export const markSourceLinkConflictInternal = internalMutation({
  args: {
    sourceLinkId: v.id("skillSourceLinks"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sourceLinkId, {
      status: "conflict",
      conflictReason: args.reason.slice(0, 1000),
      updatedAt: Date.now(),
    });
  },
});

export const finishSyncJobInternal = internalMutation({
  args: {
    jobId: v.id("githubSkillSyncJobs"),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    counts: v.object({
      discovered: v.number(),
      published: v.number(),
      skipped: v.number(),
      conflicted: v.number(),
      missing: v.number(),
    }),
    commit: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;
    await ctx.db.patch(job._id, {
      status: args.status,
      commit: args.commit ?? job.commit,
      counts: args.counts,
      error: args.error,
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const repoPatch: Partial<Doc<"publisherGitHubRepositories">> = {
      lastSyncStatus: args.status,
      lastSyncError: args.error,
      updatedAt: Date.now(),
    };
    if (args.status === "succeeded") {
      repoPatch.lastSyncedCommit = args.commit ?? job.commit;
      repoPatch.lastSyncedAt = Date.now();
    }
    await ctx.db.patch(job.repositoryId, repoPatch);
  },
});

async function syncSourceLinkRepoFullName(
  ctx: Pick<MutationCtx, "db">,
  args: { repositoryId: Id<"publisherGitHubRepositories">; repoFullName: string; now: number },
) {
  const links = await ctx.db
    .query("skillSourceLinks")
    .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
    .collect();
  for (const link of links) {
    if (link.repoFullName === args.repoFullName) continue;
    await ctx.db.patch(link._id, {
      repoFullName: args.repoFullName,
      updatedAt: args.now,
    });
  }
}

async function queueRepositorySyncInternal(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    repo: Doc<"publisherGitHubRepositories">;
    commit: string;
    ref: string;
    reason: "push" | "manual" | "repository_linked" | "backfill";
    requestedByUserId?: Id<"users">;
  },
) {
  const commit = args.commit.toLowerCase();
  if (commit) {
    const existing = await ctx.db
      .query("githubSkillSyncJobs")
      .withIndex("by_repository_commit", (q) =>
        q.eq("repositoryId", args.repo._id).eq("commit", commit),
      )
      .collect();
    if (existing.some((job) => job.status === "queued" || job.status === "running")) {
      return existing.find((job) => job.status === "queued" || job.status === "running")?._id;
    }
  }
  const now = Date.now();
  if (args.reason === "push") {
    const queued = await ctx.db
      .query("githubSkillSyncJobs")
      .withIndex("by_repository_status", (q) =>
        q.eq("repositoryId", args.repo._id).eq("status", "queued"),
      )
      .collect();
    for (const job of queued) {
      if (job.ref !== args.ref) continue;
      await ctx.db.patch(job._id, {
        status: "cancelled",
        finishedAt: now,
        updatedAt: now,
        error: "Superseded by a newer push",
      });
    }
  }
  const jobId = await ctx.db.insert("githubSkillSyncJobs", {
    publisherId: args.repo.publisherId,
    repositoryId: args.repo._id,
    repoFullName: args.repo.repoFullName,
    ref: args.ref,
    commit,
    status: "queued",
    reason: args.reason,
    requestedByUserId: args.requestedByUserId,
    counts: { discovered: 0, published: 0, skipped: 0, conflicted: 0, missing: 0 },
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(args.repo._id, {
    lastSyncStatus: "queued",
    lastSyncError: undefined,
    updatedAt: now,
  });
  return jobId;
}

type PreparedCandidateFile = {
  path: string;
  size: number;
  bytes: Uint8Array;
  sha256: string;
  contentType: string;
};

async function prepareSelectedCandidateFiles(params: {
  files: Array<{ path: string; bytes: Uint8Array }>;
  selectedPaths: string[];
  candidatePath: string;
}) {
  const byPath = new Map(params.files.map((file) => [file.path, file.bytes]));
  const candidateRoot = params.candidatePath ? `${params.candidatePath}/` : "";
  const selected = Array.from(new Set(params.selectedPaths.map((path) => normalizeRepoPath(path))));
  let totalBytes = 0;
  const preparedFiles: PreparedCandidateFile[] = [];

  for (const path of selected.sort()) {
    if (candidateRoot && !path.startsWith(candidateRoot)) continue;
    const bytes = byPath.get(path);
    if (!bytes) continue;
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_SELECTED_BYTES) throw new ConvexError("Selected files exceed 50MB limit");
    const relPath = candidateRoot ? path.slice(candidateRoot.length) : path;
    const sanitized = sanitizePath(relPath);
    if (!sanitized) continue;
    const safeBytes = new Uint8Array(bytes);
    const sha256 = await sha256Hex(safeBytes);
    preparedFiles.push({
      path: sanitized,
      size: safeBytes.byteLength,
      bytes: safeBytes,
      sha256,
      contentType: "text/plain",
    });
  }
  if (
    !preparedFiles.some(
      (file) => file.path.toLowerCase() === "skill.md" || file.path.toLowerCase() === "skills.md",
    )
  ) {
    throw new ConvexError("SKILL.md is required");
  }
  return preparedFiles;
}

async function storePreparedCandidateFiles(ctx: ActionCtx, preparedFiles: PreparedCandidateFile[]) {
  const storedFiles: Array<{
    path: string;
    size: number;
    storageId: Id<"_storage">;
    sha256: string;
    contentType?: string;
  }> = [];
  for (const file of preparedFiles) {
    const bytes = new Uint8Array(file.bytes);
    const storageId = await ctx.storage.store(
      new Blob([bytes.buffer as ArrayBuffer], { type: file.contentType }),
    );
    storedFiles.push({
      path: file.path,
      size: file.size,
      storageId,
      sha256: file.sha256,
      contentType: file.contentType,
    });
  }
  return storedFiles;
}

async function createAppJwt() {
  return await createGitHubAppJwt({
    appId: getRequiredEnv("GITHUB_APP_ID"),
    privateKeyPem: getRequiredEnv("GITHUB_APP_PRIVATE_KEY"),
  });
}

async function createInstallationToken(installationId: string) {
  const appJwt = await createAppJwt();
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: githubJsonHeaders(appJwt),
    },
  );
  if (!response.ok) throw new ConvexError(`GitHub installation token failed: ${response.status}`);
  const body = (await response.json()) as { token?: unknown };
  return requireString(body.token, "installation token");
}

async function fetchGitHubInstallation(installationId: string, appJwt: string) {
  const response = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: githubJsonHeaders(appJwt),
  });
  if (!response.ok) throw new ConvexError(`GitHub installation lookup failed: ${response.status}`);
  return (await response.json()) as GitHubInstallationResponse;
}

async function fetchGitHubInstallationRepositories(installationId: string, appJwt: string) {
  const token = await createInstallationTokenWithJwt(installationId, appJwt);
  const repos: GitHubInstallationRepository[] = [];
  let page = 1;
  while (true) {
    const response = await fetch(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      { headers: githubJsonHeaders(token) },
    );
    if (!response.ok) throw new ConvexError(`GitHub repository list failed: ${response.status}`);
    const body = (await response.json()) as GitHubInstallationRepositoriesResponse;
    repos.push(...(body.repositories ?? []));
    if ((body.repositories ?? []).length < 100) break;
    page += 1;
  }
  return repos;
}

async function createInstallationTokenWithJwt(installationId: string, appJwt: string) {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: githubJsonHeaders(appJwt),
    },
  );
  if (!response.ok) throw new ConvexError(`GitHub installation token failed: ${response.status}`);
  const body = (await response.json()) as { token?: unknown };
  return requireString(body.token, "installation token");
}

async function resolveGitHubRefCommit(repoFullName: string, ref: string, token: string) {
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/commits/${encodeURIComponent(ref)}`,
    { headers: githubJsonHeaders(token) },
  );
  if (!response.ok) throw new ConvexError(`GitHub ref lookup failed: ${response.status}`);
  const body = (await response.json()) as { sha?: unknown };
  const sha = requireString(body.sha, "commit sha");
  if (!isCommitLike(sha)) throw new ConvexError("GitHub commit sha missing");
  return sha.toLowerCase();
}

async function fetchGitHubArchiveBytes(repoFullName: string, commit: string, token: string) {
  const response = await fetch(`https://api.github.com/repos/${repoFullName}/zipball/${commit}`, {
    headers: {
      ...githubJsonHeaders(token),
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) throw new ConvexError(`GitHub archive download failed: ${response.status}`);
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader) {
    const contentLength = Number.parseInt(lengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
      throw new ConvexError("GitHub archive too large");
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new ConvexError("GitHub archive too large");
  return bytes;
}

function unzipToEntries(zipBytes: Uint8Array) {
  const entries = unzipSync(zipBytes);
  const out: ZipEntryMap = {};
  const rawPaths = Object.keys(entries);
  if (rawPaths.length > MAX_FILE_COUNT) throw new ConvexError("Repo archive has too many files");
  let totalBytes = 0;
  for (const [rawPath, bytes] of Object.entries(entries)) {
    const normalizedPath = normalizeZipPath(rawPath);
    if (!normalizedPath) continue;
    if (isMacJunkPath(normalizedPath)) continue;
    if (!bytes) continue;
    if (bytes.byteLength > MAX_SINGLE_FILE_BYTES) continue;
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_UNZIPPED_BYTES) throw new ConvexError("Repo archive is too large");
    out[normalizedPath] = bytes;
  }
  return out;
}

function githubJsonHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "clawhub-github-app-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function getGitHubAppStateSecret() {
  return process.env.GITHUB_APP_STATE_SECRET?.trim() || getRequiredEnv("GITHUB_APP_WEBHOOK_SECRET");
}

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ConvexError(`${name} is not configured`);
  return value;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new ConvexError(`GitHub ${label} missing`);
  return value.trim();
}

function requireAccountType(value: unknown) {
  if (value === "User" || value === "Organization") return value;
  throw new ConvexError("GitHub installation account type missing");
}

function assertInstallationMatchesSetup(params: {
  installationAccountId: string;
  installationAccountType: "User" | "Organization";
  targetAccountId?: string;
  callerGitHubAccountId: string | null;
  installationClaim: Doc<"githubAppInstallationClaims"> | null;
}) {
  if (
    params.installationAccountType === "User" &&
    params.callerGitHubAccountId &&
    params.installationAccountId === params.callerGitHubAccountId
  ) {
    return;
  }
  if (params.installationAccountType === "Organization" && params.targetAccountId) {
    if (
      params.installationAccountId !== params.targetAccountId.trim() ||
      params.installationClaim?.accountId !== params.installationAccountId ||
      params.installationClaim.senderAccountId !== params.callerGitHubAccountId
    ) {
      throw new ConvexError("GitHub installation account does not match setup state");
    }
    return;
  }
  throw new ConvexError("GitHub installation target must be selected before linking");
}

function normalizeIdString(value: unknown, label: string) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return requireString(value, label);
}

function normalizeOptionalId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function normalizeZipPath(path: string) {
  const normalized = path
    .replaceAll("\u0000", "")
    .replaceAll("\\", "/")
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  if (!normalized) return "";
  if (normalized.includes("..")) return "";
  return normalized;
}

function randomHex(bytes: number) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function isCommitLike(value: string) {
  return /^[a-f0-9]{40}$/i.test(value);
}

function isSyncableCommit(value: string) {
  return isCommitLike(value) && !/^0{40}$/.test(value);
}

async function sha256Hex(bytes: Uint8Array) {
  const stableBytes = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
