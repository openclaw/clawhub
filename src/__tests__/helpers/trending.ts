export function makeCanonicalTrendingPage<T>(items: T[], nextCursor: string | null = null) {
  return {
    kind: "skills" as const,
    snapshotId: "snapshot-1",
    snapshotCursor: "snapshot-cursor",
    generatedAt: "2026-07-26T00:00:00.000Z",
    windowHours: 24 as const,
    rankingVersion: "skills-trending-v1",
    totalItems: items.length,
    items,
    nextCursor,
  };
}
