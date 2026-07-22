import type { Doc } from "../../../convex/_generated/dataModel";
import type { PublicPublisher, PublicSkill } from "../../lib/publicUser";
import type { SkillsShSearchEntry, SkillsShSearchResult } from "../../lib/skillsShCatalog";

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

export type ExternalSkillListEntry = {
  source: "skills.sh";
  result: SkillsShSearchResult;
  searchScore: number;
};

export type SkillListEntry = NativeSkillListEntry | ExternalSkillListEntry;

export type NativeSkillSearchEntry = {
  skill: PublicSkill;
  version: Doc<"skillVersions"> | null;
  score: number;
  ownerHandle?: string | null;
  owner?: PublicPublisher | null;
};

export type SkillSearchEntry = NativeSkillSearchEntry | SkillsShSearchEntry;

export function isExternalSkillListEntry(entry: SkillListEntry): entry is ExternalSkillListEntry {
  return "source" in entry && entry.source === "skills.sh";
}

export function buildSkillHref(skill: PublicSkill, ownerHandle?: string | null) {
  const owner = ownerHandle?.trim() || String(skill.ownerPublisherId ?? skill.ownerUserId);
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(skill.slug)}`;
}
