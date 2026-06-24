export type PluginOgMeta = {
  name: string | null;
  displayName: string | null;
  summary: string | null;
  owner: string | null;
  ownerImage: string | null;
  latestVersion: string | null;
  stats: {
    downloads: number;
  };
  verification: {
    scanStatus: string | null;
  } | null;
};

export async function fetchPluginOgMeta(
  packageName: string,
  apiBase: string,
): Promise<PluginOgMeta | null> {
  try {
    const url = new URL(`/api/v1/packages/${encodeURIComponent(packageName)}`, apiBase);
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      package?: {
        name?: string;
        displayName?: string;
        summary?: string | null;
        latestVersion?: string | null;
        stats?: unknown;
        verification?: { scanStatus?: string | null } | null;
      } | null;
      owner?: { handle?: string | null; image?: string | null } | null;
    };
    const stats = readStats(payload.package?.stats);
    return {
      name: payload.package?.name ?? null,
      displayName: payload.package?.displayName ?? null,
      summary: payload.package?.summary ?? null,
      owner: payload.owner?.handle ?? null,
      ownerImage: payload.owner?.image ?? null,
      latestVersion: payload.package?.latestVersion ?? null,
      stats: {
        downloads: readNumber(stats.downloads),
      },
      verification: payload.package?.verification
        ? { scanStatus: payload.package.verification.scanStatus ?? null }
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
