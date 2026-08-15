import { type inferred, type } from "arktype";
import { CatalogFeedPublisherTrustSchema, CatalogFeedStateSchema } from "./catalogFeed.js";
import { ClawManifestSummarySchema } from "./claws.js";

export const EXPERIMENTAL_CLAW_FEED_SCHEMA_VERSION = 1;
export const EXPERIMENTAL_CLAW_FEED_ID = "clawhub-official-claws";
export const EXPERIMENTAL_CLAW_FEED_DESCRIPTION =
  "Claws published by verified OpenClaw publishers on ClawHub.";

export const ExperimentalClawFeedInstallCandidateSchema = type({
  "+": "reject",
  sourceRef: '"public-clawhub"',
  package: "string",
  version: "string",
  integrity: "string",
});

export const ExperimentalClawFeedEntrySchema = type({
  "+": "reject",
  type: '"claw"',
  id: "string",
  title: "string",
  description: "string?",
  icon: "string?",
  version: "string",
  state: CatalogFeedStateSchema,
  publisher: {
    "+": "reject",
    id: "string",
    trust: CatalogFeedPublisherTrustSchema,
  },
  clawManifestSummary: ClawManifestSummarySchema,
  install: {
    "+": "reject",
    candidates: ExperimentalClawFeedInstallCandidateSchema.array(),
  },
});
export type ExperimentalClawFeedEntry = (typeof ExperimentalClawFeedEntrySchema)[inferred];

export const ExperimentalClawFeedSchema = type({
  "+": "reject",
  schemaVersion: "number",
  id: "string",
  generatedAt: "string",
  sequence: "number",
  expiresAt: "string",
  description: "string?",
  entries: ExperimentalClawFeedEntrySchema.array(),
});
export type ExperimentalClawFeed = (typeof ExperimentalClawFeedSchema)[inferred];

export function parseExperimentalClawFeed(value: unknown): ExperimentalClawFeed {
  const feed = ExperimentalClawFeedSchema.assert(value);
  if (feed.schemaVersion !== EXPERIMENTAL_CLAW_FEED_SCHEMA_VERSION) {
    throw new Error(`Unsupported experimental Claw feed schema version: ${feed.schemaVersion}`);
  }
  if (feed.id !== EXPERIMENTAL_CLAW_FEED_ID) {
    throw new Error(`Unsupported experimental Claw feed id: ${feed.id}`);
  }
  if (feed.sequence < 0 || !Number.isSafeInteger(feed.sequence)) {
    throw new Error("Experimental Claw feed sequence must be a non-negative integer");
  }
  if (
    !Number.isFinite(Date.parse(feed.generatedAt)) ||
    !Number.isFinite(Date.parse(feed.expiresAt))
  ) {
    throw new Error("Experimental Claw feed timestamps must be valid ISO dates");
  }
  if (Date.parse(feed.expiresAt) <= Date.parse(feed.generatedAt)) {
    throw new Error("Experimental Claw feed expiresAt must be after generatedAt");
  }
  for (const entry of feed.entries) {
    if (entry.publisher.trust !== "official") {
      throw new Error("Experimental Claw feed publisher trust must be official");
    }
    if (entry.install.candidates.length !== 1) {
      throw new Error("Experimental Claw feed entries must have exactly one install candidate");
    }
    for (const candidate of entry.install.candidates) {
      if (candidate.package !== entry.id) {
        throw new Error("Experimental Claw feed candidate package must match entry id");
      }
      if (candidate.version !== entry.version) {
        throw new Error("Experimental Claw feed candidate version must match entry version");
      }
      if (!/^sha256:[0-9a-f]{64}$/.test(candidate.integrity)) {
        throw new Error(
          "Experimental Claw feed candidate integrity must be lowercase sha256 with 64 hex characters",
        );
      }
    }
  }
  return feed;
}

export function serializeExperimentalClawFeed(feed: ExperimentalClawFeed): string {
  const parsed = parseExperimentalClawFeed(feed);
  const entries = [...parsed.entries]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => ({
      type: entry.type,
      id: entry.id,
      title: entry.title,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.icon === undefined ? {} : { icon: entry.icon }),
      version: entry.version,
      state: entry.state,
      publisher: { id: entry.publisher.id, trust: entry.publisher.trust },
      clawManifestSummary: {
        schemaVersion: entry.clawManifestSummary.schemaVersion,
        agent: {
          id: entry.clawManifestSummary.agent.id,
          ...(entry.clawManifestSummary.agent.name === undefined
            ? {}
            : { name: entry.clawManifestSummary.agent.name }),
          ...(entry.clawManifestSummary.agent.description === undefined
            ? {}
            : { description: entry.clawManifestSummary.agent.description }),
        },
        workspace: {
          bootstrapFiles: [...entry.clawManifestSummary.workspace.bootstrapFiles].sort(),
          fileCount: entry.clawManifestSummary.workspace.fileCount,
        },
        packages: {
          skillCount: entry.clawManifestSummary.packages.skillCount,
          pluginCount: entry.clawManifestSummary.packages.pluginCount,
        },
        ...(entry.clawManifestSummary.profiles === undefined
          ? {}
          : {
              profiles: {
                count: entry.clawManifestSummary.profiles.count,
                hasOpenClaw: entry.clawManifestSummary.profiles.hasOpenClaw,
              },
            }),
        ...(entry.clawManifestSummary.extensions === undefined
          ? {}
          : { extensions: { count: entry.clawManifestSummary.extensions.count } }),
        mcpServerCount: entry.clawManifestSummary.mcpServerCount,
        cronJobCount: entry.clawManifestSummary.cronJobCount,
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
