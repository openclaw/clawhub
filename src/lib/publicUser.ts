import type { PublicPublisher, PublicSkill } from "../../convex/lib/public";

export type { PublicPublisher, PublicSkill, PublicUser } from "../../convex/lib/public";

export type SkillListItemData = {
  _id: string;
  slug: string;
  displayName: string;
  summary?: string | null;
  icon?: string;
  ownerUserId?: string;
  ownerPublisherId?: string | null;
  categories?: string[] | null;
  inferredCategories?: string[] | null;
  latestVersionId?: string | null;
  inferredFromVersionId?: string | null;
  topics?: string[];
  badges?: PublicSkill["badges"] | null;
  stats: Pick<PublicSkill["stats"], "downloads" | "stars">;
  updatedAt: number;
};

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

export type PublicPublisherProfileItem = Omit<
  PublicPublisherListItem,
  "publishedItems" | "stats"
> & {
  stats: PublicPublisherStats & {
    /** Both counts are absent while a backend that predates the Templates tab is still serving. */
    plugins?: number;
    templates?: number;
  };
};

export type PublicPublisherCatalogItem = {
  _id: string;
  kind: "skill" | "plugin" | "template";
  slug?: string | null;
  displayName: string;
  summary: string | null;
  topics?: string[];
  categories?: string[];
  inferredCategories?: string[];
  latestVersionId?: string | null;
  inferredFromVersionId?: string | null;
  /** Hosted bundled icon path; older records may retain legacy icon values. */
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
