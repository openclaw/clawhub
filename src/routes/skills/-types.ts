import type { Doc } from "../../../convex/_generated/dataModel";
import type { PublicPublisher, PublicSkill } from "../../lib/publicUser";

export type SkillListEntry = {
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
  skill: PublicSkill;
  version: Doc<"skillVersions"> | null;
  score: number;
  ownerHandle?: string | null;
  owner?: PublicPublisher | null;
};

export function buildSkillHref(skill: PublicSkill, ownerHandle?: string | null) {
  const owner = ownerHandle?.trim() || String(skill.ownerPublisherId ?? skill.ownerUserId);
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(skill.slug)}`;
}
