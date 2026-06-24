import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { convexHttp } from "../convex/client";
import type { PublicPublisher, PublicSkill } from "./publicUser";

type GeneratedSkillCardFile = {
  path: string;
  size: number;
  sha256: string;
  contentType?: string;
};

export type SkillBySlugResult = {
  requestedSlug?: string | null;
  resolvedSlug?: string | null;
  skill: Doc<"skills"> | PublicSkill;
  latestVersion:
    | (Doc<"skillVersions"> & { generatedSkillCard?: GeneratedSkillCardFile | null })
    | null;
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
  lookupOwnerHandle?: string | null;
};

type SkillPageLoaderData = {
  owner: string | null;
  displayName: string | null;
  summary: string | null;
  version: string | null;
  initialData: SkillPageInitialData | null;
};

type SkillLookupResult = {
  result: SkillBySlugResult;
  lookupOwnerHandle?: string | null;
};

function normalizeOwnerLookupSegment(value: string | null | undefined) {
  return value?.trim().replace(/^@+/, "").toLowerCase() || null;
}

function ownerMatchesLookup(
  owner: PublicPublisher | null | undefined,
  ownerHandle: string | undefined,
) {
  const requested = normalizeOwnerLookupSegment(ownerHandle);
  if (!requested) return true;
  const candidates = [owner?.handle, owner?._id, owner?.linkedUserId]
    .map((candidate) => normalizeOwnerLookupSegment(candidate))
    .filter(Boolean);
  return candidates.includes(requested);
}

function readActionText(value: unknown) {
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text;
  }
  return null;
}

async function querySkillBySlug(slug: string, ownerHandle?: string): Promise<SkillLookupResult> {
  if (!ownerHandle) {
    const result = (await convexHttp.query(api.skills.getBySlug, { slug })) as SkillBySlugResult;
    return { result };
  }

  try {
    const result = (await convexHttp.query(api.skills.getBySlug, {
      slug,
      ownerHandle,
    })) as SkillBySlugResult;
    return { result, lookupOwnerHandle: ownerHandle };
  } catch {
    const result = (await convexHttp.query(api.skills.getBySlug, { slug })) as SkillBySlugResult;
    if (!result?.skill || !ownerMatchesLookup(result.owner, ownerHandle)) {
      return { result: null, lookupOwnerHandle: null };
    }
    return { result, lookupOwnerHandle: null };
  }
}

export async function fetchSkillPageData(
  slug: string,
  ownerHandle?: string,
): Promise<SkillPageLoaderData> {
  try {
    const { result, lookupOwnerHandle } = await querySkillBySlug(slug, ownerHandle);

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
        const response = await convexHttp.action(api.skills.getReadme, {
          versionId: result.latestVersion._id,
        });
        readme = readActionText(response);
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
        ...(ownerHandle ? { lookupOwnerHandle } : {}),
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
