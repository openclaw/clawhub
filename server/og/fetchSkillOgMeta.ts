export type SkillOgMeta = {
  displayName: string | null;
  summary: string | null;
  owner: string | null;
  version: string | null;
};

export async function fetchSkillOgMeta(slug: string, apiBase: string): Promise<SkillOgMeta | null> {
  try {
    const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, apiBase);
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      skill?: { displayName?: string; summary?: string | null } | null;
      owner?: { handle?: string | null } | null;
      latestVersion?: { version?: string | null } | null;
    };
    return {
      displayName: payload.skill?.displayName ?? null,
      summary: payload.skill?.summary ?? null,
      owner: payload.owner?.handle ?? null,
      version: payload.latestVersion?.version ?? null,
    };
  } catch {
    return null;
  }
}
