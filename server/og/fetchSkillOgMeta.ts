import { readCanonicalStat, type SkillStatReadable } from "../../convex/lib/skillStats";

type SkillApiPayload = SkillStatReadable & {
  displayName?: string;
  summary?: string | null;
};

export type SkillOgMeta = {
  displayName: string | null;
  summary: string | null;
  owner: string | null;
  ownerImage: string | null;
  version: string | null;
  stats: {
    downloads: number;
  };
  moderation: {
    verdict: "clean" | "suspicious" | "malicious" | null;
    isSuspicious: boolean;
    isMalwareBlocked: boolean;
  } | null;
};

export async function fetchSkillOgMeta(
  slug: string,
  apiBase: string,
  ownerHandle?: string | null,
): Promise<SkillOgMeta | null> {
  try {
    const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, apiBase);
    const owner = ownerHandle?.trim().replace(/^@+/, "");
    if (owner) url.searchParams.set("ownerHandle", owner);
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      skill?: SkillApiPayload | null;
      owner?: { handle?: string | null; image?: string | null } | null;
      latestVersion?: { version?: string | null } | null;
      moderation?: {
        verdict?: "clean" | "suspicious" | "malicious";
        isSuspicious?: boolean;
        isMalwareBlocked?: boolean;
      } | null;
    };
    return {
      displayName: payload.skill?.displayName ?? null,
      summary: payload.skill?.summary ?? null,
      owner: payload.owner?.handle ?? null,
      ownerImage: payload.owner?.image ?? null,
      version: payload.latestVersion?.version ?? null,
      stats: {
        downloads: payload.skill ? readCanonicalStat(payload.skill, "downloads") : 0,
      },
      moderation: payload.moderation
        ? {
            verdict: payload.moderation.verdict ?? null,
            isSuspicious: Boolean(payload.moderation.isSuspicious),
            isMalwareBlocked: Boolean(payload.moderation.isMalwareBlocked),
          }
        : null,
    };
  } catch {
    return null;
  }
}
