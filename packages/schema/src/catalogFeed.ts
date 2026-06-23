import { type inferred, type } from "arktype";

export const CatalogFeedStateSchema = type(
  '"available"|"recommended"|"disabled"|"blocked"|"deprecated"',
);
export type CatalogFeedState = (typeof CatalogFeedStateSchema)[inferred];

export const CatalogFeedPublisherTrustSchema = type('"official"|"community"');
export type CatalogFeedPublisherTrust = (typeof CatalogFeedPublisherTrustSchema)[inferred];

export const CatalogFeedInstallCandidateSchema = type({
  "+": "reject",
  sourceRef: "string",
  package: "string",
  version: "string",
  integrity: "string",
});
export type CatalogFeedInstallCandidate = (typeof CatalogFeedInstallCandidateSchema)[inferred];

const CatalogFeedEntryBaseSchema = {
  "+": "reject",
  id: "string",
  title: "string",
  version: "string",
  state: CatalogFeedStateSchema,
  publisher: {
    "+": "reject",
    id: "string",
    trust: CatalogFeedPublisherTrustSchema,
  },
  install: {
    "+": "reject",
    candidates: CatalogFeedInstallCandidateSchema.array(),
  },
} as const;

export const CatalogFeedPluginEntrySchema = type({
  ...CatalogFeedEntryBaseSchema,
  type: '"plugin"',
});
export type CatalogFeedPluginEntry = (typeof CatalogFeedPluginEntrySchema)[inferred];

export const CatalogFeedSkillEntrySchema = type({
  ...CatalogFeedEntryBaseSchema,
  type: '"skill"',
});
export type CatalogFeedSkillEntry = (typeof CatalogFeedSkillEntrySchema)[inferred];

export const CatalogFeedEntrySchema = type(
  CatalogFeedPluginEntrySchema.or(CatalogFeedSkillEntrySchema),
);
export type CatalogFeedEntry = (typeof CatalogFeedEntrySchema)[inferred];

export const CatalogFeedSchema = type({
  "+": "reject",
  schemaVersion: "number",
  id: "string",
  generatedAt: "string",
  sequence: "number",
  expiresAt: "string",
  description: "string?",
  entries: CatalogFeedEntrySchema.array(),
});
export type CatalogFeed = (typeof CatalogFeedSchema)[inferred];

export const CATALOG_FEED_SCHEMA_VERSION = 1;
export const CATALOG_FEED_ID = "clawhub-official";
export const CATALOG_FEED_SOURCE_REF = "public-clawhub";
export const CATALOG_SKILLS_FEED_ID = "clawhub-official-skills";
export const CATALOG_SKILLS_FEED_DESCRIPTION =
  "Skills published by verified OpenClaw publishers on ClawHub.";

export function parseCatalogFeed(value: unknown): CatalogFeed {
  const feed = CatalogFeedSchema.assert(value);
  if (feed.schemaVersion !== CATALOG_FEED_SCHEMA_VERSION) {
    throw new Error(`Unsupported catalog feed schema version: ${feed.schemaVersion}`);
  }
  if (feed.sequence < 0 || !Number.isSafeInteger(feed.sequence)) {
    throw new Error("Catalog feed sequence must be a non-negative integer");
  }
  if (
    !Number.isFinite(Date.parse(feed.generatedAt)) ||
    !Number.isFinite(Date.parse(feed.expiresAt))
  ) {
    throw new Error("Catalog feed timestamps must be valid ISO dates");
  }
  if (Date.parse(feed.expiresAt) <= Date.parse(feed.generatedAt)) {
    throw new Error("Catalog feed expiresAt must be after generatedAt");
  }
  return feed;
}

export function serializeCatalogFeed(feed: CatalogFeed): string {
  const parsed = parseCatalogFeed(feed);
  const entries = [...parsed.entries]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => ({
      type: entry.type,
      id: entry.id,
      title: entry.title,
      version: entry.version,
      state: entry.state,
      publisher: {
        id: entry.publisher.id,
        trust: entry.publisher.trust,
      },
      install: {
        candidates: [...entry.install.candidates]
          .sort((left, right) =>
            [left.sourceRef, left.package, left.version, left.integrity]
              .join("\u0000")
              .localeCompare(
                [right.sourceRef, right.package, right.version, right.integrity].join("\u0000"),
              ),
          )
          .map((candidate) => ({
            sourceRef: candidate.sourceRef,
            package: candidate.package,
            version: candidate.version,
            integrity: candidate.integrity,
          })),
      },
    }));
  return JSON.stringify({
    schemaVersion: parsed.schemaVersion,
    id: parsed.id,
    generatedAt: parsed.generatedAt,
    sequence: parsed.sequence,
    expiresAt: parsed.expiresAt,
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
    entries,
  });
}
