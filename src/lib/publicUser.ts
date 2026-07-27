import type { Doc } from "../../convex/_generated/dataModel";

export type PublicUser = Pick<
  Doc<"users">,
  "_id" | "_creationTime" | "handle" | "name" | "displayName" | "image" | "bio"
>;

export type PublicPublisher = Pick<
  Doc<"publishers">,
  | "_id"
  | "_creationTime"
  | "kind"
  | "handle"
  | "displayName"
  | "image"
  | "bio"
  | "linkedUserId"
  | "githubHandle"
  | "githubVerifiedAt"
> & { official?: boolean };

type PublicPublisherStats = {
  skills: number;
  packages: number;
  installs: number;
  downloads: number;
  stars: number;
};

export type PublicPublisherSummary = PublicPublisher & {
  stats: PublicPublisherStats;
};

export type PublicPublisherPublishedItem = {
  kind: "skill" | "plugin";
  displayName: string;
  summary?: string | null;
  slug?: string | null;
  categories?: string[];
  inferredCategories?: string[];
  latestVersionId?: string | null;
  inferredFromVersionId?: string | null;
  installs?: number;
  downloads?: number;
};

export type PublicPublisherListItem = PublicPublisherSummary & {
  publishedItems: PublicPublisherPublishedItem[];
  starredCount?: number;
  affiliations?: Array<{
    publisher: PublicPublisher;
    role: "owner" | "admin" | "publisher";
  }>;
};

export type PublicPublisherProfileItem = Omit<PublicPublisherListItem, "publishedItems">;

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
  /** Legacy skill icon field or plugin manifest HTTPS icon URL retained in responses. */
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

export function readPublicDownloadCount(value: { downloads?: number; installs?: number }) {
  return value.downloads ?? value.installs ?? 0;
}

type PublicSkillStats = {
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
