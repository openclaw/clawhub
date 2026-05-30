import type { SkillOrigin } from "../../skills.js";
import type { SkillFolder } from "../scanSkills.js";

export type SyncOptions = {
  root?: string[];
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
  owner?: string;
  bump?: "patch" | "minor" | "major";
  changelog?: string;
  tags?: string;
  concurrency?: number;
  clawdbotRoots?: boolean;
  sourceRepo?: string;
  sourceCommit?: string;
  sourceRef?: string;
};

export type Candidate = SkillFolder & {
  fingerprint: string;
  fileCount: number;
  origin: SkillOrigin | null;
  status: "synced" | "new" | "update";
  matchVersion: string | null;
  latestVersion: string | null;
};

export type LocalSkill = SkillFolder & {
  fingerprint: string;
  fileCount: number;
  origin: SkillOrigin | null;
};
