import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalQuery, query } from "./functions";
import { requireUser, requireUserFromAction } from "./lib/access";
import { fetchGitHubLoginByProviderAccountId } from "./lib/githubAccount";
import { fetchGitHubRepositoryIdentity } from "./lib/githubActionsOidc";
import { getGitHubProviderAccountId } from "./lib/githubIdentity";
import { GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS } from "./lib/githubOrgMemberships";
import { requirePublisherRole } from "./lib/publishers";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
} from "./lib/skills/slugResolution";
import {
  buildBulkAdoptionPreviewItem,
  type BulkAdoptionDestination,
} from "./lib/skillsShBulkAdoption";
import { assertSkillsShFixtureEnvironmentAllowed } from "./lib/skillsShCatalogEnvironment";

const MAX_PREVIEW_PAGE_SIZE = 100;
const MAX_MIRRORED_PREVIEW_PAGE_SIZE = 25;

type MirroredPublisherContext = {
  publisher: {
    _id: Doc<"publishers">["_id"];
    handle: string;
    displayName: string;
    kind: "user" | "org";
  };
  ownership:
    | {
        kind: "personal";
        githubOwnerId: number;
      }
    | {
        kind: "organization";
        githubOwnerId: number;
        githubLogin: string;
        verifiedAt: number;
        membershipSyncedAt: number;
      };
};

type MirroredAdoptionPreview = {
  canStart: boolean;
  blockingReason: string | null;
  idempotencyKey: string;
  source: {
    externalId: string;
    repository: string;
    owner: string;
    repo: string;
    slug: string;
    githubPath: string;
    githubCommit: string;
    githubContentHash: string;
    sourceContentHash: string;
    sourceSnapshotId: string;
    sourceUrl: string;
  };
  destination:
    | {
        kind: "create";
        fingerprint: string;
      }
    | {
        kind: "replace";
        fingerprint: string;
      }
    | {
        kind: "conflict";
        fingerprint: null;
      };
};

type MirroredBulkPreviewItem = {
  externalId: string;
  displayName: string;
  sourceUrl: string;
  upstreamInstalls: number;
  classification: "new-destination" | "replacement" | "ownership-conflict" | "unavailable";
  canStart: boolean;
  blockingReason: string | null;
  source: MirroredAdoptionPreview["source"] | null;
  destination: MirroredAdoptionPreview["destination"] | null;
  start: {
    sourceContentHash: string;
    idempotencyKey: string;
    expectedDestinationFingerprint: string;
  } | null;
};

type MirroredBulkPreviewResult = {
  publisher: MirroredPublisherContext["publisher"];
  ownership: MirroredPublisherContext["ownership"];
  page: MirroredBulkPreviewItem[];
  isDone: boolean;
  continueCursor: string;
};

const internalRefs = internal as unknown as {
  skillsShBulkAdoption: {
    getMirroredPublisherContextInternal: unknown;
  };
  skillsShMirror: {
    listActiveGithubByOwnerInternal: unknown;
  };
  skillsShAdoption: {
    getMirroredPreviewInternal: unknown;
  };
};

function parseGitHubOwnerId(value: string | undefined, error: string) {
  if (!value || !/^[1-9]\d*$/.test(value)) throw new ConvexError(error);
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new ConvexError(error);
  return id;
}

async function getVerifiedPublisherOwnership(
  ctx: QueryCtx,
  publisher: Doc<"publishers">,
  userId: Doc<"users">["_id"],
) {
  if (publisher.kind === "user") {
    if (publisher.linkedUserId !== userId) throw new ConvexError("Forbidden");
    const providerAccountId = await getGitHubProviderAccountId(ctx, userId);
    return {
      kind: "personal" as const,
      githubOwnerId: parseGitHubOwnerId(
        providerAccountId ?? undefined,
        "Reconnect GitHub to verify your personal account",
      ),
    };
  }

  const githubOwnerId = parseGitHubOwnerId(
    publisher.githubOrgId,
    "Connect a verified GitHub organization to this publisher",
  );
  if (!publisher.githubVerifiedAt) {
    throw new ConvexError("Connect a verified GitHub organization to this publisher");
  }
  const membership = await ctx.db
    .query("githubOrgMemberships")
    .withIndex("by_user_and_github_org", (q) =>
      q.eq("userId", userId).eq("githubOrgId", String(githubOwnerId)),
    )
    .unique();
  if (
    !membership ||
    membership.role !== "admin" ||
    Date.now() - membership.syncedAt > GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS
  ) {
    throw new ConvexError("Reconnect GitHub to verify current organization admin access");
  }
  return {
    kind: "organization" as const,
    githubOwnerId,
    githubLogin: membership.login,
    verifiedAt: publisher.githubVerifiedAt,
    membershipSyncedAt: membership.syncedAt,
  };
}

async function resolveDestination(
  ctx: QueryCtx,
  publisher: Doc<"publishers">,
  entry: Doc<"skillsShCatalogEntries">,
): Promise<BulkAdoptionDestination> {
  const [skill, alias] = await Promise.all([
    getSkillBySlugForPublisher(ctx, entry.slug, publisher),
    getSkillSlugAliasBySlugForPublisher(ctx, entry.slug, publisher),
  ]);
  if (alias && (!skill || alias.skillId !== skill._id)) {
    const aliasedSkill = await ctx.db.get(alias.skillId);
    return {
      kind: "alias",
      skillId: alias.skillId,
      ownerPublisherId: publisher._id,
      ownerHandle: publisher.handle,
      slug: entry.slug,
      displayName: aliasedSkill?.displayName ?? entry.slug,
    };
  }
  if (skill) {
    return {
      kind: "owned",
      skillId: skill._id,
      ownerPublisherId: publisher._id,
      ownerHandle: publisher.handle,
      slug: skill.slug,
      displayName: skill.displayName,
      activeVersion: skill.latestVersionSummary?.version,
      unavailableReason: skill.softDeletedAt ? "destination-soft-deleted" : undefined,
    };
  }
  return { kind: "none" };
}

export const previewPublisherEntries = query({
  args: {
    publisherId: v.id("publishers"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > MAX_PREVIEW_PAGE_SIZE
    ) {
      throw new ConvexError(`numItems must be an integer between 1 and ${MAX_PREVIEW_PAGE_SIZE}`);
    }
    const { userId } = await requireUser(ctx);
    const { publisher } = await requirePublisherRole(ctx, {
      publisherId: args.publisherId,
      userId,
      allowed: ["admin"],
    });
    const ownership = await getVerifiedPublisherOwnership(ctx, publisher, userId);
    const entries = await ctx.db
      .query("skillsShCatalogEntries")
      .withIndex("by_source_kind_and_github_owner_id_and_owner", (q) =>
        q.eq("sourceKind", "staging-live").eq("githubOwnerId", ownership.githubOwnerId),
      )
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      entries.page.map(async (entry) =>
        buildBulkAdoptionPreviewItem({
          publisherId: publisher._id,
          entry: {
            externalId: entry.externalId,
            githubOwnerId: entry.githubOwnerId,
            owner: entry.owner,
            repo: entry.repo,
            slug: entry.slug,
            displayName: entry.displayName,
            sourceUrl: entry.sourceUrl,
            githubRepoUrl: entry.githubRepoUrl,
            githubPath: entry.githubPath,
            githubCommit: entry.githubCommit,
            githubContentHash: entry.githubContentHash,
            sourceContentHash: entry.sourceContentHash,
          },
          destination: await resolveDestination(ctx, publisher, entry),
        }),
      ),
    );
    return {
      publisher: {
        _id: publisher._id,
        handle: publisher.handle,
        kind: publisher.kind,
      },
      ownership,
      catalogSourceKind: "staging-live" as const,
      ...entries,
      page,
    };
  },
});

export const getMirroredPublisherContextInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
    publisherId: v.id("publishers"),
  },
  handler: async (ctx, args) => {
    assertSkillsShFixtureEnvironmentAllowed();
    const { publisher } = await requirePublisherRole(ctx, {
      publisherId: args.publisherId,
      userId: args.actorUserId,
      allowed: ["admin"],
    });
    const ownership = await getVerifiedPublisherOwnership(ctx, publisher, args.actorUserId);
    return {
      publisher: {
        _id: publisher._id,
        handle: publisher.handle,
        displayName: publisher.displayName,
        kind: publisher.kind,
      },
      ownership,
    };
  },
});

export const previewMirroredPublisherEntries = action({
  args: {
    publisherId: v.id("publishers"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<MirroredBulkPreviewResult> => {
    assertSkillsShFixtureEnvironmentAllowed();
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > MAX_MIRRORED_PREVIEW_PAGE_SIZE
    ) {
      throw new ConvexError(
        `numItems must be an integer between 1 and ${MAX_MIRRORED_PREVIEW_PAGE_SIZE}`,
      );
    }
    const { userId } = await requireUserFromAction(ctx);
    const context = (await ctx.runQuery(
      internalRefs.skillsShBulkAdoption.getMirroredPublisherContextInternal as never,
      {
        actorUserId: userId,
        publisherId: args.publisherId,
      } as never,
    )) as MirroredPublisherContext;
    const owner =
      context.ownership.kind === "organization"
        ? context.ownership.githubLogin
        : await fetchGitHubLoginByProviderAccountId(String(context.ownership.githubOwnerId));
    const digests = (await ctx.runQuery(
      internalRefs.skillsShMirror.listActiveGithubByOwnerInternal as never,
      {
        owner: owner.toLowerCase(),
        paginationOpts: args.paginationOpts,
      } as never,
    )) as {
      page: Doc<"skillsShMirrorDigests">[];
      isDone: boolean;
      continueCursor: string;
    };
    const repositoryIdentities = new Map<
      string,
      Awaited<ReturnType<typeof fetchGitHubRepositoryIdentity>>
    >();
    const page: MirroredBulkPreviewItem[] = [];

    for (const digest of digests.page) {
      const repository =
        digest.owner && digest.repo ? `${digest.owner}/${digest.repo}`.toLowerCase() : null;
      const sourceComplete =
        repository && digest.githubPath && digest.githubCommit && digest.sourceContentHash;
      if (!sourceComplete) {
        page.push({
          externalId: digest.externalId,
          displayName: digest.displayName,
          sourceUrl: digest.sourceUrl,
          upstreamInstalls: digest.upstreamInstalls,
          classification: "unavailable" as const,
          canStart: false,
          blockingReason: "source_incomplete" as const,
          source: null,
          destination: null,
          start: null,
        });
        continue;
      }

      try {
        let identity = repositoryIdentities.get(repository);
        if (!identity) {
          identity = await fetchGitHubRepositoryIdentity(repository);
          repositoryIdentities.set(repository, identity);
        }
        const githubOwnerId = Number(identity.repositoryOwnerId);
        if (!Number.isSafeInteger(githubOwnerId)) {
          throw new ConvexError("GitHub repository owner identity is invalid");
        }
        const preview = (await ctx.runQuery(
          internalRefs.skillsShAdoption.getMirroredPreviewInternal as never,
          {
            actorUserId: userId,
            publisherId: args.publisherId,
            externalId: digest.externalId,
            githubOwnerId,
            canonicalRepository: identity.repository,
          } as never,
        )) as MirroredAdoptionPreview | null;
        if (!preview) {
          page.push({
            externalId: digest.externalId,
            displayName: digest.displayName,
            sourceUrl: digest.sourceUrl,
            upstreamInstalls: digest.upstreamInstalls,
            classification: "unavailable" as const,
            canStart: false,
            blockingReason: "source_unavailable" as const,
            source: null,
            destination: null,
            start: null,
          });
          continue;
        }
        const classification =
          preview.destination.kind === "conflict"
            ? ("ownership-conflict" as const)
            : preview.destination.kind === "replace"
              ? ("replacement" as const)
              : ("new-destination" as const);
        page.push({
          externalId: digest.externalId,
          displayName: digest.displayName,
          sourceUrl: digest.sourceUrl,
          upstreamInstalls: digest.upstreamInstalls,
          classification,
          canStart: preview.canStart,
          blockingReason: preview.blockingReason,
          source: preview.source,
          destination: preview.destination,
          start:
            preview.canStart && preview.destination.fingerprint
              ? {
                  sourceContentHash: preview.source.sourceContentHash,
                  idempotencyKey: preview.idempotencyKey,
                  expectedDestinationFingerprint: preview.destination.fingerprint,
                }
              : null,
        });
      } catch {
        page.push({
          externalId: digest.externalId,
          displayName: digest.displayName,
          sourceUrl: digest.sourceUrl,
          upstreamInstalls: digest.upstreamInstalls,
          classification: "unavailable" as const,
          canStart: false,
          blockingReason: "github_identity_unavailable" as const,
          source: null,
          destination: null,
          start: null,
        });
      }
    }

    return {
      publisher: context.publisher,
      ownership: context.ownership,
      page,
      isDone: digests.isDone,
      continueCursor: digests.continueCursor,
    };
  },
});
