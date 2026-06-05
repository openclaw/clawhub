import type { Doc } from "../../convex/_generated/dataModel";

export type PublicUser = Pick<
  Doc<"users">,
  "_id" | "_creationTime" | "handle" | "name" | "displayName" | "image" | "bio"
>;

export type PublicPublisher = Pick<
  Doc<"publishers">,
  "_id" | "_creationTime" | "kind" | "handle" | "displayName" | "image" | "bio" | "linkedUserId"
> & { official?: boolean };

type PublicPublisherStats = {
  skills: number;
  packages: number;
  installs: number;
  downloads: number;
  stars: number;
};

export type PublicPublisherPublishedItem = {
  kind: "skill" | "plugin";
  displayName: string;
  downloads: number;
};

export type PublicPublisherListItem = PublicPublisher & {
  stats: PublicPublisherStats;
  publishedItems: PublicPublisherPublishedItem[];
  starredCount?: number;
  affiliations?: Array<{
    publisher: PublicPublisher;
    role: "owner" | "admin" | "publisher";
  }>;
};

export type PublicPublisherCatalogItem = {
  _id: string;
  kind: "skill" | "plugin";
  displayName: string;
  summary: string | null;
  /**
   * Skill custom-icon protocol string (e.g. `lucide:Plug`) mirrored from
   * `skills.icon`. Always `null` for `kind: "plugin"` items in Phase 1.
   */
  icon: string | null;
  href: string;
  downloads: number;
  stars: number;
  isOfficial: boolean;
  updatedAt: number;
  sourceBacked?: boolean;
  sourceRepo?: string | null;
  sourcePath?: string | null;
  sourceVerifiedCommit?: string | null;
};

type PublicPublisherCatalogSection = {
  key: string;
  title: string;
  description: string | null;
  sourceRepo: string | null;
  items: PublicPublisherCatalogItem[];
};

export type PublicPublisherCatalogDisplay = {
  mode: "grouped";
  sourceRepos: string[];
  sections: PublicPublisherCatalogSection[];
};

export type PublicSkill = Pick<
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
  | "capabilityTags"
  | "badges"
  | "stats"
  | "isSuspicious"
  | "createdAt"
  | "updatedAt"
> & {
  githubSourceRepo?: string;
};

export type PublicSoul = Pick<
  Doc<"souls">,
  | "_id"
  | "_creationTime"
  | "slug"
  | "displayName"
  | "summary"
  | "ownerUserId"
  | "ownerPublisherId"
  | "latestVersionId"
  | "tags"
  | "stats"
  | "createdAt"
  | "updatedAt"
>;
