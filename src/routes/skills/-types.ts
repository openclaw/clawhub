import type { Doc } from "../../../convex/_generated/dataModel";
import type { PublicPublisher, PublicSkill } from "../../lib/publicUser";
import type { CanonicalTrendingItem } from "../../lib/trendingApi";

export type NativeSkillListEntry = {
  skill: PublicSkill;
  latestVersion: {
    version: string;
    createdAt: number;
    changelog: string;
    changelogSource?: "auto" | "user";
    parsed?: {
      clawdis?: {
        os?: string[];
        nix?: {
          plugin?: boolean;
          systems?: string[];
        };
      };
    };
  } | null;
  ownerHandle?: string | null;
  owner?: PublicPublisher | null;
  searchScore?: number;
};

export type SkillSearchEntry = {
  id: string;
  source: "clawhub" | "skills-sh";
  slug: string;
  displayName: string;
  summary: string | null;
  score: number;
  canonicalUrl: string;
  links: {
    canonical: string;
    source: string | null;
  };
  official: boolean;
  featured: boolean;
  publisher: {
    kind: "user" | "org";
    handle: string | null;
    displayName: string | null;
    image: string | null;
    official: boolean;
  } | null;
  install: {
    kind: "clawhub" | "github" | "skills-sh";
    reference: string;
    sourceUrl: string | null;
  };
  sourceIdentity: {
    id: string;
    owner: string | null;
    repo: string | null;
    host: string | null;
    lifetimeInstalls: number | null;
  };
  trust: {
    visibility: "public";
    installability: "installable";
    clawHubVerdict: string | null;
    upstreamScanners: unknown;
    sourceFreshness: "native" | "observed-only";
  };
  metrics: {
    rolling60DayInstalls: number | null;
    bookmarks: number | null;
    updatedAt: number;
  };
  native: {
    skill: PublicSkill;
    version: Doc<"skillVersions"> | null;
    owner: PublicPublisher | null;
    ownerHandle: string | null;
  } | null;
  ownerHandle: string | null;
  version: string | null;
  downloads: number;
  updatedAt: number;
};

export type ExternalSkillListEntry = {
  external: SkillSearchEntry;
  searchScore: number;
};

export type TrendingSkillListEntry = {
  trending: CanonicalTrendingItem;
};

export type SkillListEntry = NativeSkillListEntry | ExternalSkillListEntry | TrendingSkillListEntry;

export function isExternalSkillListEntry(entry: SkillListEntry): entry is ExternalSkillListEntry {
  return "external" in entry;
}

export function isTrendingSkillListEntry(entry: SkillListEntry): entry is TrendingSkillListEntry {
  return "trending" in entry;
}

export function buildSkillHref(skill: PublicSkill, ownerHandle?: string | null) {
  const owner = ownerHandle?.trim() || String(skill.ownerPublisherId ?? skill.ownerUserId);
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(skill.slug)}`;
}
