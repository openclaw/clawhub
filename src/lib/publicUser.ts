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
  installs?: number;
  downloads?: number;
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
  slug?: string | null;
  displayName: string;
  summary: string | null;
  topics?: string[];
  categories?: string[];
  inferredCategories?: string[];
  latestVersionId?: string | null;
  inferredFromVersionId?: string | null;
  /** Legacy skill icon field retained in responses for cached clients. */
  icon: string | null;
  href: string;
  installs?: number;
  downloads?: number;
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

export function readPublicInstallCount(value: { installs?: number; downloads?: number }) {
  return value.installs ?? value.downloads ?? 0;
}

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
  | "categories"
  | "inferredCategories"
  | "inferredFromVersionId"
  | "topics"
  | "badges"
  | "stats"
  | "isSuspicious"
  | "createdAt"
  | "updatedAt"
> & {
  githubSourceRepo?: string;
};
