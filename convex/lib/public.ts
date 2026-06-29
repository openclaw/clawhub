import type { Doc } from "../_generated/dataModel";
import { isPublicSkillDoc } from "./globalStats";
import { readCanonicalStat } from "./skillStats";

export type PublicUser = Pick<
  Doc<"users">,
  "_id" | "_creationTime" | "handle" | "name" | "displayName" | "image" | "bio"
>;

export type PublicPublisher = Pick<
  Doc<"publishers">,
  "_id" | "_creationTime" | "kind" | "handle" | "displayName" | "image" | "bio" | "linkedUserId"
> & { official?: boolean };

export type PublicSkillStats = {
  downloads: number;
  stars: number;
  installs: number;
  versions: number;
  comments: number;
};

export type PublicSkill = Omit<
  Pick<
    Doc<"skills">,
    | "_id"
    | "_creationTime"
    | "slug"
    | "displayName"
    | "summary"
    | "icon"
    | "ownerUserId"
    | "ownerPublisherId"
    | "canonicalSkillId"
    | "forkOf"
    | "latestVersionId"
    | "installKind"
    | "githubPath"
    | "githubCurrentCommit"
    | "githubCurrentStatus"
    | "githubScanStatus"
    | "githubHasSkillCard"
    | "tags"
    | "categories"
    | "inferredCategories"
    | "inferredFromVersionId"
    | "topics"
    | "badges"
    | "stats"
    | "isSuspicious"
    | "createdAt"
    | "updatedAt"
  >,
  "stats"
> & {
  stats: PublicSkillStats;
  githubSourceRepo?: string;
};

/**
 * Minimum set of fields needed by `hydrateResults` to filter and convert
 * a skill into a `PublicSkill`.  Both `Doc<'skills'>` and the lightweight
 * `skillSearchDigest` row (after mapping) satisfy this interface, so the
 * compiler will catch any field that drifts between them.
 */
export type HydratableSkill = Pick<
  Doc<"skills">,
  | "_id"
  | "_creationTime"
  | "slug"
  | "displayName"
  | "summary"
  | "icon"
  | "ownerUserId"
  | "ownerPublisherId"
  | "canonicalSkillId"
  | "forkOf"
  | "latestVersionId"
  | "installKind"
  | "githubHasSkillCard"
  | "githubCurrentStatus"
  | "githubScanStatus"
  | "latestVersionSummary"
  | "tags"
  | "categories"
  | "inferredCategories"
  | "inferredFromVersionId"
  | "topics"
  | "badges"
  | "stats"
  | "statsDownloads"
  | "statsStars"
  | "statsInstallsCurrent"
  | "statsInstallsAllTime"
  | "softDeletedAt"
  | "moderationStatus"
  | "moderationFlags"
  | "moderationVerdict"
  | "moderationReason"
  | "isSuspicious"
  | "createdAt"
  | "updatedAt"
> &
  Partial<Pick<Doc<"skills">, "githubPath" | "githubCurrentCommit">>;

export function toPublicUser(user: Doc<"users"> | null | undefined): PublicUser | null {
  if (!user || user.deletedAt || user.deactivatedAt) return null;
  return {
    _id: user._id,
    _creationTime: user._creationTime,
    handle: user.handle,
    name: user.name,
    displayName: user.displayName,
    image: user.image,
    bio: user.bio,
  };
}

export function toPublicPublisher(
  publisher: Doc<"publishers"> | null | undefined,
  options?: { official?: boolean },
): PublicPublisher | null {
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return null;
  return {
    _id: publisher._id,
    _creationTime: publisher._creationTime,
    kind: publisher.kind,
    handle: publisher.handle,
    displayName: publisher.displayName,
    image: publisher.image,
    bio: publisher.bio,
    linkedUserId: publisher.linkedUserId,
    ...(options?.official ? { official: true } : {}),
  };
}

export function toPublicSkill(skill: HydratableSkill | null | undefined): PublicSkill | null {
  if (!skill) return null;
  if (!isPublicSkillDoc(skill)) return null;
  const stats = {
    downloads: readCanonicalStat(skill, "downloads"),
    stars: readCanonicalStat(skill, "stars"),
    installs: readCanonicalStat(skill, "installsAllTime"),
    versions: skill.stats?.versions ?? 0,
    comments: skill.stats?.comments ?? 0,
  };
  return {
    _id: skill._id,
    _creationTime: skill._creationTime,
    slug: skill.slug,
    displayName: skill.displayName,
    summary: skill.summary,
    icon: skill.icon,
    ownerUserId: skill.ownerUserId,
    ownerPublisherId: skill.ownerPublisherId,
    canonicalSkillId: skill.canonicalSkillId,
    forkOf: skill.forkOf,
    latestVersionId: skill.latestVersionId,
    installKind: skill.installKind,
    githubPath: skill.githubPath,
    githubCurrentCommit: skill.githubCurrentCommit,
    githubCurrentStatus: skill.githubCurrentStatus,
    githubScanStatus: skill.githubScanStatus,
    githubHasSkillCard: skill.githubHasSkillCard,
    tags: skill.tags,
    categories: skill.categories,
    inferredCategories: skill.inferredCategories,
    inferredFromVersionId: skill.inferredFromVersionId,
    topics: skill.topics,
    badges: skill.badges,
    stats,
    isSuspicious: skill.isSuspicious,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}
