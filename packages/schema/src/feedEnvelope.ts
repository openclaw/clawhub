type FeedEnvelope = {
  schemaVersion: number;
  id: string;
  generatedAt: string;
  sequence: number;
  expiresAt: string;
  description?: string;
};

export function assertFeedTiming(
  feed: Pick<FeedEnvelope, "sequence" | "generatedAt" | "expiresAt">,
  label: "Catalog" | "Promotions" | "Experimental Template",
) {
  if (feed.sequence < 0 || !Number.isSafeInteger(feed.sequence)) {
    throw new Error(`${label} feed sequence must be a non-negative integer`);
  }
  if (
    !Number.isFinite(Date.parse(feed.generatedAt)) ||
    !Number.isFinite(Date.parse(feed.expiresAt))
  ) {
    throw new Error(`${label} feed timestamps must be valid ISO dates`);
  }
  if (Date.parse(feed.expiresAt) <= Date.parse(feed.generatedAt)) {
    throw new Error(`${label} feed expiresAt must be after generatedAt`);
  }
}

export function serializeFeedEnvelope(feed: FeedEnvelope, entries: readonly unknown[]): string {
  return JSON.stringify({
    schemaVersion: feed.schemaVersion,
    id: feed.id,
    generatedAt: feed.generatedAt,
    sequence: feed.sequence,
    expiresAt: feed.expiresAt,
    ...(feed.description === undefined ? {} : { description: feed.description }),
    entries,
  });
}
