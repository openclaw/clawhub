export type SoulOgMeta = {
  displayName: string | null;
  summary: string | null;
  owner: string | null;
  version: string | null;
};

export async function fetchSoulOgMeta(slug: string, apiBase: string): Promise<SoulOgMeta | null> {
  try {
    const url = new URL(`/api/v1/souls/${encodeURIComponent(slug)}`, apiBase);
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      soul?: { displayName?: string; summary?: string | null } | null;
      owner?: { handle?: string | null } | null;
      latestVersion?: { version?: string | null } | null;
    };
    return {
      displayName: payload.soul?.displayName ?? null,
      summary: payload.soul?.summary ?? null,
      owner: payload.owner?.handle ?? null,
      version: payload.latestVersion?.version ?? null,
    };
  } catch {
    return null;
  }
}
