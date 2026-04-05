import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { convexHttp } from "../convex/client";
import type { PublicPublisher, PublicSkill } from "./publicUser";

export type SkillBySlugResult = {
  requestedSlug?: string | null;
  resolvedSlug?: string | null;
  skill: Doc<"skills"> | PublicSkill;
  latestVersion: Doc<"skillVersions"> | null;
  owner: PublicPublisher | null;
  pendingReview?: boolean;
  moderationInfo?: {
    isPendingScan: boolean;
    isMalwareBlocked: boolean;
    isSuspicious: boolean;
    isHiddenByMod: boolean;
    isRemoved: boolean;
    overrideActive?: boolean;
    verdict?: "clean" | "suspicious" | "malicious";
    reasonCodes?: string[];
    summary?: string | null;
    engineVersion?: string | null;
    updatedAt?: number | null;
    reason?: string;
  } | null;
  forkOf: {
    kind: "fork" | "duplicate";
    version: string | null;
    skill: { slug: string; displayName: string };
    owner: { handle: string | null; userId: Id<"users"> | null };
  } | null;
  canonical: {
    skill: { slug: string; displayName: string };
    owner: { handle: string | null; userId: Id<"users"> | null };
  } | null;
} | null;

export type SkillPageInitialData = {
  result: SkillBySlugResult;
  readme: string | null;
  readmeError: string | null;
};

type SkillPageLoaderData = {
  owner: string | null;
  displayName: string | null;
  summary: string | null;
  version: string | null;
  initialData: SkillPageInitialData | null;
};

export async function fetchSkillPageData(slug: string): Promise<SkillPageLoaderData> {
  try {
    const result = (await convexHttp.query(api.skills.getBySlug, {
      slug,
    })) as SkillBySlugResult;

    if (!result?.skill) {
      return {
        owner: null,
        displayName: null,
        summary: null,
        version: null,
        initialData: null,
      };
    }

    let readme: string | null = null;
    let readmeError: string | null = null;

    if (result.latestVersion?._id) {
      try {
        const response = (await convexHttp.action(api.skills.getReadme, {
          versionId: result.latestVersion._id,
        })) as { text: string };
        readme = response.text;
      } catch (error) {
        readmeError = error instanceof Error ? error.message : "Failed to load SKILL.md";
      }
    }

    return {
      owner:
        result.owner?.handle ??
        result.owner?.displayName ??
        (result.owner as { name?: string | null } | null)?.name ??
        null,
      displayName: result.skill.displayName ?? null,
      summary: result.skill.summary ?? null,
      version: result.latestVersion?.version ?? null,
      initialData: {
        result,
        readme,
        readmeError,
      },
    };
  } catch {
    return {
      owner: null,
      displayName: null,
      summary: null,
      version: null,
      initialData: null,
    };
  }
}
