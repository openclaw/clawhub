export type SkillOgMeta = {
  displayName: string | null;
  summary: string | null;
  owner: string | null;
  ownerImage: string | null;
  version: string | null;
  stats: {
    installsAllTime: number;
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
      skill?: { displayName?: string; summary?: string | null; stats?: unknown } | null;
      owner?: { handle?: string | null; image?: string | null } | null;
      latestVersion?: { version?: string | null } | null;
      moderation?: {
        verdict?: "clean" | "suspicious" | "malicious";
        isSuspicious?: boolean;
        isMalwareBlocked?: boolean;
      } | null;
    };
    const stats = readStats(payload.skill?.stats);
    return {
      displayName: payload.skill?.displayName ?? null,
      summary: payload.skill?.summary ?? null,
      owner: payload.owner?.handle ?? null,
      ownerImage: payload.owner?.image ?? null,
      version: payload.latestVersion?.version ?? null,
      stats: {
        installsAllTime: readNumber(stats.installsAllTime),
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

function readStats(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
