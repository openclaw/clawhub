import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { action, internalQuery } from "./functions";
import { fetchGitHubSkillSourceSnapshot } from "./githubSkillSync";
import { requireUserFromAction } from "./lib/access";
import { buildGitHubApiHeaders } from "./lib/githubAuth";
import { getGitHubProviderAccountId } from "./lib/githubIdentity";
import { GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS } from "./lib/githubOrgMemberships";
import {
  classifyGitHubSkillSyncPreviewItem,
  type GitHubSkillSyncDiscoveredSkill,
  type GitHubSkillSyncPreviewDestination,
  type GitHubSkillSyncPreviewItem,
} from "./lib/githubSkillSyncSettings";
import { requirePublisherRole } from "./lib/publishers";
import { assertGitHubSkillSyncRuntimeEnabled } from "./lib/rolloutCapabilities";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
} from "./lib/skills/slugResolution";
import { assertValidSkillSlug } from "./lib/skillSlugValidator";

const GITHUB_API = "https://api.github.com";
const DEFAULT_REPOSITORY_PAGE_SIZE = 100;
const MAX_REPOSITORY_PAGE_SIZE = 100;

type PublisherContext = {
  publisherId: Id<"publishers">;
  publisherHandle: string;
  publisherKind: "user" | "org";
  githubOwnerId: string;
  githubLogin?: string;
};

type GitHubRepositoryMetadata = {
  repositoryId: string;
  repo: string;
  ownerId: string;
  ownerLogin: string;
  defaultBranch: string;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
};

type GitHubRepositoryListItem = GitHubRepositoryMetadata & {
  pushedAt: string | null;
  selectable: boolean;
  unavailableReason: "disabled" | null;
};

type GitHubSkillSyncRepositoryListResult = {
  publisher: {
    _id: Id<"publishers">;
    handle: string;
    kind: "user" | "org";
  };
  page: number;
  perPage: number;
  hasMore: boolean;
  repositories: GitHubRepositoryListItem[];
};

type GitHubSkillSyncRepositoryPreviewResult = {
  publisher: {
    _id: Id<"publishers">;
    handle: string;
    kind: "user" | "org";
  };
  repository: {
    requestedRepo: string;
    repositoryId: string;
    repo: string;
    redirected: boolean;
    defaultBranch: string;
    commit: string;
  };
  summary: {
    total: number;
    newDestinations: number;
    replacements: number;
    unavailable: number;
    conflicts: number;
  };
  items: GitHubSkillSyncPreviewItem[];
};

const discoveredSkillValidator = v.object({
  slug: v.string(),
  displayName: v.string(),
  path: v.string(),
  contentHash: v.string(),
});

function parseGitHubNumericId(value: unknown, message: string) {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : typeof value === "string" && /^[1-9]\d*$/.test(value.trim())
        ? value.trim()
        : "";
  if (!normalized) throw new ConvexError(message);
  return normalized;
}

export async function getGitHubSkillSyncPublisherContextHandler(
  ctx: QueryCtx,
  args: {
    publisherId: Id<"publishers">;
    userId: Id<"users">;
    now?: number;
  },
): Promise<PublisherContext> {
  const { publisher } = await requirePublisherRole(ctx, {
    publisherId: args.publisherId,
    userId: args.userId,
    allowed: ["admin"],
  });
  if (publisher.kind === "user") {
    if (publisher.linkedUserId !== args.userId) throw new ConvexError("Forbidden");
    const githubOwnerId = parseGitHubNumericId(
      await getGitHubProviderAccountId(ctx, args.userId),
      "Reconnect GitHub to verify your personal account",
    );
    return {
      publisherId: publisher._id,
      publisherHandle: publisher.handle,
      publisherKind: "user",
      githubOwnerId,
    };
  }

  const githubOwnerId = parseGitHubNumericId(
    publisher.githubOrgId,
    "Connect a verified GitHub organization to this publisher",
  );
  if (!publisher.githubVerifiedAt) {
    throw new ConvexError("Connect a verified GitHub organization to this publisher");
  }
  const membership = await ctx.db
    .query("githubOrgMemberships")
    .withIndex("by_user_and_github_org", (q) =>
      q.eq("userId", args.userId).eq("githubOrgId", githubOwnerId),
    )
    .unique();
  const now = args.now ?? Date.now();
  if (
    !membership ||
    membership.role !== "admin" ||
    now - membership.syncedAt > GITHUB_ORG_MEMBERSHIP_VERIFICATION_MAX_AGE_MS
  ) {
    throw new ConvexError("Reconnect GitHub to verify current organization admin access");
  }
  return {
    publisherId: publisher._id,
    publisherHandle: publisher.handle,
    publisherKind: "org",
    githubOwnerId,
    githubLogin: membership.login,
  };
}

export const getGitHubSkillSyncPublisherContextInternal = internalQuery({
  args: {
    publisherId: v.id("publishers"),
    userId: v.id("users"),
  },
  handler: getGitHubSkillSyncPublisherContextHandler,
});

async function resolvePreviewDestination(
  ctx: QueryCtx,
  publisher: Doc<"publishers">,
  source: Doc<"githubSkillSources"> | null,
  discovered: GitHubSkillSyncDiscoveredSkill,
): Promise<GitHubSkillSyncPreviewDestination> {
  if (source?.ownerPublisherId && source.ownerPublisherId !== publisher._id) {
    const owner = await ctx.db.get(source.ownerPublisherId);
    return {
      kind: "source-conflict",
      ownerPublisherId: source.ownerPublisherId,
      ownerHandle: owner?.handle ?? "another publisher",
    };
  }

  const [skill, alias] = await Promise.all([
    getSkillBySlugForPublisher(ctx, discovered.slug, publisher),
    getSkillSlugAliasBySlugForPublisher(ctx, discovered.slug, publisher),
  ]);
  if (alias && (!skill || alias.skillId !== skill._id)) {
    const aliasedSkill = await ctx.db.get(alias.skillId);
    return {
      kind: "alias-conflict",
      skillId: alias.skillId,
      ownerPublisherId: publisher._id,
      ownerHandle: publisher.handle,
      slug: discovered.slug,
      displayName: aliasedSkill?.displayName ?? discovered.displayName,
    };
  }
  if (!skill) return { kind: "none" };

  let unavailableReason:
    | "destination-soft-deleted"
    | "already-synced"
    | "destination-uses-another-github-source"
    | undefined;
  if (skill.softDeletedAt) {
    unavailableReason = "destination-soft-deleted";
  } else if (skill.installKind === "github") {
    unavailableReason =
      source && skill.githubSourceId === source._id && skill.githubPath === discovered.path
        ? "already-synced"
        : "destination-uses-another-github-source";
  }
  return {
    kind: "owned",
    skillId: skill._id,
    ownerPublisherId: publisher._id,
    ownerHandle: publisher.handle,
    slug: skill.slug,
    displayName: skill.displayName,
    installKind: skill.installKind === "github" ? "github" : "hosted",
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

export async function classifyGitHubSkillSyncRepositoryHandler(
  ctx: QueryCtx,
  args: {
    publisherId: Id<"publishers">;
    repo: string;
    skills: GitHubSkillSyncDiscoveredSkill[];
  },
): Promise<GitHubSkillSyncPreviewItem[]> {
  const publisher = await ctx.db.get(args.publisherId);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
    throw new ConvexError("Publisher not found");
  }
  const source = await ctx.db
    .query("githubSkillSources")
    .withIndex("by_repo", (q) => q.eq("repo", args.repo))
    .unique();

  return await Promise.all(
    args.skills.map(async (discovered) => {
      let invalidSlug = false;
      try {
        assertValidSkillSlug(discovered.slug);
      } catch {
        invalidSlug = true;
      }
      return classifyGitHubSkillSyncPreviewItem({
        discovered,
        destination: await resolvePreviewDestination(ctx, publisher, source, discovered),
        invalidSlug,
      });
    }),
  );
}

export const classifyGitHubSkillSyncRepositoryInternal = internalQuery({
  args: {
    publisherId: v.id("publishers"),
    repo: v.string(),
    skills: v.array(discoveredSkillValidator),
  },
  handler: classifyGitHubSkillSyncRepositoryHandler,
});

async function requireActionPublisherContext(
  ctx: Pick<ActionCtx, "runQuery">,
  publisherId: Id<"publishers">,
  authOverride?: { userId: Id<"users"> },
): Promise<PublisherContext> {
  const actor = authOverride ?? (await requireUserFromAction(ctx as ActionCtx));
  return (await ctx.runQuery(
    internal.githubSkillSyncSettings.getGitHubSkillSyncPublisherContextInternal,
    {
      publisherId,
      userId: actor.userId,
    },
  )) as PublisherContext;
}

async function buildGitHubSettingsHeaders(fetcher: typeof fetch) {
  return await buildGitHubApiHeaders({
    userAgent: "clawhub/github-skill-sync-settings",
    fetchImpl: fetcher,
  });
}

async function fetchVerifiedOwnerLogin(context: PublisherContext, fetcher: typeof fetch) {
  const endpoint =
    context.publisherKind === "org"
      ? `${GITHUB_API}/organizations/${context.githubOwnerId}`
      : `${GITHUB_API}/user/${context.githubOwnerId}`;
  const response = await fetcher(endpoint, {
    headers: await buildGitHubSettingsHeaders(fetcher),
  });
  if (!response.ok) throw new ConvexError("GitHub account lookup failed");
  const body = (await response.json()) as Record<string, unknown>;
  const id = parseGitHubNumericId(body.id, "GitHub account lookup failed");
  const login = typeof body.login === "string" ? body.login.trim() : "";
  if (id !== context.githubOwnerId || !login) {
    throw new ConvexError("GitHub account lookup failed");
  }
  return login;
}

function parseRepositoryMetadata(
  value: unknown,
  expectedOwnerId?: string,
): GitHubRepositoryMetadata | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const owner =
    row.owner && typeof row.owner === "object" ? (row.owner as Record<string, unknown>) : null;
  const repo = typeof row.full_name === "string" ? row.full_name.trim() : "";
  const repositoryId =
    typeof row.id === "number" && Number.isSafeInteger(row.id) && row.id > 0
      ? String(row.id)
      : typeof row.id === "string" && /^[1-9]\d*$/.test(row.id.trim())
        ? row.id.trim()
        : "";
  const ownerLogin = typeof owner?.login === "string" ? owner.login.trim() : "";
  const ownerId =
    typeof owner?.id === "number" && Number.isSafeInteger(owner.id) && owner.id > 0
      ? String(owner.id)
      : typeof owner?.id === "string" && /^[1-9]\d*$/.test(owner.id.trim())
        ? owner.id.trim()
        : "";
  if (
    !repositoryId ||
    !repo ||
    !ownerLogin ||
    !ownerId ||
    (expectedOwnerId && ownerId !== expectedOwnerId) ||
    row.private !== false ||
    (typeof row.visibility === "string" && row.visibility !== "public")
  ) {
    return null;
  }
  return {
    repositoryId,
    repo,
    ownerId,
    ownerLogin,
    defaultBranch:
      typeof row.default_branch === "string" && row.default_branch.trim()
        ? row.default_branch.trim()
        : "main",
    archived: row.archived === true,
    disabled: row.disabled === true,
    fork: row.fork === true,
  };
}

function toRepositoryListItem(
  value: unknown,
  expectedOwnerId: string,
): GitHubRepositoryListItem | null {
  const metadata = parseRepositoryMetadata(value, expectedOwnerId);
  if (!metadata) return null;
  const row = value as Record<string, unknown>;
  const unavailableReason = metadata.disabled ? "disabled" : null;
  return {
    ...metadata,
    pushedAt: typeof row.pushed_at === "string" ? row.pushed_at : null,
    selectable: unavailableReason === null,
    unavailableReason,
  };
}

export async function listGitHubSkillSyncRepositoriesHandler(
  ctx: Pick<ActionCtx, "runQuery">,
  args: {
    publisherId: Id<"publishers">;
    page?: number;
    perPage?: number;
  },
  fetcher: typeof fetch = fetch,
  authOverride?: { userId: Id<"users"> },
): Promise<GitHubSkillSyncRepositoryListResult> {
  assertGitHubSkillSyncRuntimeEnabled();
  const context = await requireActionPublisherContext(ctx, args.publisherId, authOverride);
  const login = context.githubLogin ?? (await fetchVerifiedOwnerLogin(context, fetcher));
  const page = clampInteger(args.page ?? 1, 1, 100);
  const perPage = clampInteger(
    args.perPage ?? DEFAULT_REPOSITORY_PAGE_SIZE,
    1,
    MAX_REPOSITORY_PAGE_SIZE,
  );
  const endpoint =
    context.publisherKind === "org"
      ? `${GITHUB_API}/orgs/${encodeURIComponent(login)}/repos`
      : `${GITHUB_API}/users/${encodeURIComponent(login)}/repos`;
  const url = new URL(endpoint);
  url.searchParams.set("type", context.publisherKind === "org" ? "all" : "owner");
  url.searchParams.set("sort", "pushed");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  const response = await fetcher(url, {
    headers: await buildGitHubSettingsHeaders(fetcher),
  });
  if (!response.ok) throw new ConvexError("GitHub repository lookup failed");
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) throw new ConvexError("GitHub repository lookup failed");
  const repositories = body
    .map((repo) => toRepositoryListItem(repo, context.githubOwnerId))
    .filter((repo): repo is GitHubRepositoryListItem => repo !== null);
  return {
    publisher: {
      _id: context.publisherId,
      handle: context.publisherHandle,
      kind: context.publisherKind,
    },
    page,
    perPage,
    hasMore: body.length === perPage,
    repositories,
  };
}

export const listRepositories: ReturnType<typeof action> = action({
  args: {
    publisherId: v.id("publishers"),
    page: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<GitHubSkillSyncRepositoryListResult> =>
    listGitHubSkillSyncRepositoriesHandler(ctx, args),
});

async function fetchVerifiedRepositoryMetadata(
  repo: string,
  expectedOwnerId: string,
  fetcher: typeof fetch,
) {
  const normalizedRepo = normalizeRepo(repo);
  const [owner, name] = normalizedRepo.split("/") as [string, string];
  const response = await fetcher(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    {
      headers: await buildGitHubSettingsHeaders(fetcher),
    },
  );
  if (!response.ok) {
    if (response.status === 404) throw new ConvexError("Enter a public GitHub repo.");
    throw new ConvexError("GitHub repo lookup failed.");
  }
  const metadata = parseRepositoryMetadata(await response.json(), expectedOwnerId);
  if (!metadata) {
    throw new ConvexError("Repository ownership does not match the selected publisher.");
  }
  if (metadata.disabled) throw new ConvexError("GitHub repo is disabled.");
  return { requestedRepo: normalizedRepo, ...metadata };
}

export async function previewGitHubSkillSyncRepositoryHandler(
  ctx: Pick<ActionCtx, "runQuery">,
  args: {
    publisherId: Id<"publishers">;
    repo: string;
  },
  fetcher: typeof fetch = fetch,
  authOverride?: { userId: Id<"users"> },
): Promise<GitHubSkillSyncRepositoryPreviewResult> {
  assertGitHubSkillSyncRuntimeEnabled();
  const context = await requireActionPublisherContext(ctx, args.publisherId, authOverride);
  const metadata = await fetchVerifiedRepositoryMetadata(args.repo, context.githubOwnerId, fetcher);
  const snapshot = await fetchGitHubSkillSourceSnapshot(
    {
      repo: metadata.repo,
      defaultBranch: metadata.defaultBranch,
    },
    fetcher,
  );
  if (snapshot.skills.length === 0) {
    throw new ConvexError("No skills were found in that public GitHub repo.");
  }
  const discovered = snapshot.skills.map(({ slug, displayName, path, contentHash }) => ({
    slug,
    displayName,
    path,
    contentHash,
  }));
  const items = (await ctx.runQuery(
    internal.githubSkillSyncSettings.classifyGitHubSkillSyncRepositoryInternal,
    {
      publisherId: context.publisherId,
      repo: metadata.repo,
      skills: discovered,
    },
  )) as GitHubSkillSyncPreviewItem[];
  const count = (classification: GitHubSkillSyncPreviewItem["classification"]) =>
    items.filter((item) => item.classification === classification).length;
  return {
    publisher: {
      _id: context.publisherId,
      handle: context.publisherHandle,
      kind: context.publisherKind,
    },
    repository: {
      requestedRepo: metadata.requestedRepo,
      repositoryId: metadata.repositoryId,
      repo: metadata.repo,
      redirected: metadata.requestedRepo.toLowerCase() !== metadata.repo.toLowerCase(),
      defaultBranch: metadata.defaultBranch,
      commit: snapshot.commit,
    },
    summary: {
      total: items.length,
      newDestinations: count("new-destination"),
      replacements: count("replacement"),
      unavailable: count("unavailable"),
      conflicts: count("ownership-conflict"),
    },
    items,
  };
}

export const previewRepository: ReturnType<typeof action> = action({
  args: {
    publisherId: v.id("publishers"),
    repo: v.string(),
  },
  handler: async (ctx, args): Promise<GitHubSkillSyncRepositoryPreviewResult> =>
    previewGitHubSkillSyncRepositoryHandler(ctx, args),
});

function normalizeRepo(value: string) {
  const trimmed = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/i, "")
    .split(/[?#]/)[0];
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length !== 2) throw new ConvexError("GitHub repo must be owner/repo");
  return `${parts[0]}/${parts[1]}`;
}

function clampInteger(value: number, min: number, max: number) {
  const finite = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.min(max, Math.max(min, finite));
}
