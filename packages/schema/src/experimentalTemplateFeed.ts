import { type inferred, type } from "arktype";
import { CatalogFeedPublisherTrustSchema, CatalogFeedStateSchema } from "./catalogFeed.js";
import { TemplateManifestSummarySchema } from "./templates.js";

export const EXPERIMENTAL_TEMPLATE_FEED_SCHEMA_VERSION = 1;
export const EXPERIMENTAL_TEMPLATE_FEED_ID = "clawhub-official-templates";
export const EXPERIMENTAL_TEMPLATE_FEED_DESCRIPTION =
  "Templates published by verified OpenClaw publishers on ClawHub.";

export const ExperimentalTemplateFeedInstallCandidateSchema = type({
  "+": "reject",
  sourceRef: '"public-clawhub"',
  package: "string",
  version: "string",
  integrity: "string",
});

export const ExperimentalTemplateFeedEntrySchema = type({
  "+": "reject",
  type: '"template"',
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
  templateManifestSummary: TemplateManifestSummarySchema,
  install: {
    "+": "reject",
    candidates: ExperimentalTemplateFeedInstallCandidateSchema.array(),
  },
});
export type ExperimentalTemplateFeedEntry = (typeof ExperimentalTemplateFeedEntrySchema)[inferred];

export const ExperimentalTemplateFeedSchema = type({
  "+": "reject",
  schemaVersion: "number",
  id: "string",
  generatedAt: "string",
  sequence: "number",
  expiresAt: "string",
  description: "string?",
  entries: ExperimentalTemplateFeedEntrySchema.array(),
});
export type ExperimentalTemplateFeed = (typeof ExperimentalTemplateFeedSchema)[inferred];

export function parseExperimentalTemplateFeed(value: unknown): ExperimentalTemplateFeed {
  const feed = ExperimentalTemplateFeedSchema.assert(value);
  if (feed.schemaVersion !== EXPERIMENTAL_TEMPLATE_FEED_SCHEMA_VERSION) {
    throw new Error(`Unsupported experimental Template feed schema version: ${feed.schemaVersion}`);
  }
  if (feed.id !== EXPERIMENTAL_TEMPLATE_FEED_ID) {
    throw new Error(`Unsupported experimental Template feed id: ${feed.id}`);
  }
  if (feed.sequence < 0 || !Number.isSafeInteger(feed.sequence)) {
    throw new Error("Experimental Template feed sequence must be a non-negative integer");
  }
  if (
    !Number.isFinite(Date.parse(feed.generatedAt)) ||
    !Number.isFinite(Date.parse(feed.expiresAt))
  ) {
    throw new Error("Experimental Template feed timestamps must be valid ISO dates");
  }
  if (Date.parse(feed.expiresAt) <= Date.parse(feed.generatedAt)) {
    throw new Error("Experimental Template feed expiresAt must be after generatedAt");
  }
  for (const entry of feed.entries) {
    if (entry.publisher.trust !== "official") {
      throw new Error("Experimental Template feed publisher trust must be official");
    }
    if (entry.install.candidates.length !== 1) {
      throw new Error("Experimental Template feed entries must have exactly one install candidate");
    }
    for (const candidate of entry.install.candidates) {
      if (candidate.package !== entry.id) {
        throw new Error("Experimental Template feed candidate package must match entry id");
      }
      if (candidate.version !== entry.version) {
        throw new Error("Experimental Template feed candidate version must match entry version");
      }
      if (!/^sha256:[0-9a-f]{64}$/.test(candidate.integrity)) {
        throw new Error(
          "Experimental Template feed candidate integrity must be lowercase sha256 with 64 hex characters",
        );
      }
    }
  }
  return feed;
}

export function serializeExperimentalTemplateFeed(feed: ExperimentalTemplateFeed): string {
  const parsed = parseExperimentalTemplateFeed(feed);
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
      templateManifestSummary: {
        schemaVersion: entry.templateManifestSummary.schemaVersion,
        agent: {
          id: entry.templateManifestSummary.agent.id,
          ...(entry.templateManifestSummary.agent.name === undefined
            ? {}
            : { name: entry.templateManifestSummary.agent.name }),
          ...(entry.templateManifestSummary.agent.description === undefined
            ? {}
            : { description: entry.templateManifestSummary.agent.description }),
        },
        workspace: {
          bootstrapFiles: [...entry.templateManifestSummary.workspace.bootstrapFiles].sort(),
          fileCount: entry.templateManifestSummary.workspace.fileCount,
        },
        packages: {
          skillCount: entry.templateManifestSummary.packages.skillCount,
          pluginCount: entry.templateManifestSummary.packages.pluginCount,
        },
        ...(entry.templateManifestSummary.profiles === undefined
          ? {}
          : {
              profiles: {
                count: entry.templateManifestSummary.profiles.count,
                hasOpenClaw: entry.templateManifestSummary.profiles.hasOpenClaw,
              },
            }),
        ...(entry.templateManifestSummary.extensions === undefined
          ? {}
          : { extensions: { count: entry.templateManifestSummary.extensions.count } }),
        mcpServerCount: entry.templateManifestSummary.mcpServerCount,
        cronJobCount: entry.templateManifestSummary.cronJobCount,
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
