import { type } from "arktype";

export const FeaturedEditorialSaveSchema = type({
  "+": "reject",
  expectedRevision: "number.integer >= 0",
  items: type({
    "+": "reject",
    id: "string",
    name: "string",
    displayName: "string",
    reason: "string",
  })
    .array()
    .atMostLength(8),
});

export const FeaturedSelectionPublishSchema = type({
  "+": "reject",
  reportId: "string > 0",
  expectedEditorialRevision: "number.integer >= 0",
  expectedPublicationAt: "number | null",
  periodStart: "number.integer",
  periodEnd: "number.integer",
  items: type({
    "+": "reject",
    id: "string",
    version: "string",
    selectionBasis: '"editorial" | "telemetry"',
    reason: "string",
    "installs30d?": "number.integer >= 0",
    "installs7d?": "number.integer >= 0",
  })
    .array()
    .atLeastLength(16)
    .atMostLength(16),
  dryRun: "boolean",
});
