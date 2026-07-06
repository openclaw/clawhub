import type { CatalogFeedEntry, CatalogFeedInstallCandidate } from "./catalogFeed.js";

export const OPENCLAW_REGISTRY_EXPORT_SCHEMA_VERSION = 1;

export type OpenClawRegistryExportReflectedState =
  | "pending"
  | "reviewed"
  | "rejected"
  | "scan_pending"
  | "scan_passed"
  | "scan_failed"
  | "registry_included"
  | "registry_removed";

export type OpenClawRegistryExportInput = {
  feedId: string;
  feedSequence: number;
  feedPayloadDigest?: string | null;
  entry: CatalogFeedEntry;
  candidate?: CatalogFeedInstallCandidate;
  exportedAt: string;
  exportActorId?: string | null;
};

export type OpenClawRegistryExport = {
  schemaVersion: typeof OPENCLAW_REGISTRY_EXPORT_SCHEMA_VERSION;
  exportId: string;
  idempotencyKey: string;
  exportedAt: string;
  exportActorId: string | null;
  clawhub: {
    feed: {
      id: string;
      sequence: number;
      payloadDigest: string | null;
      entryId: string;
      entryState: CatalogFeedEntry["state"];
    };
    publisher: {
      id: string;
      official: boolean;
    };
    candidate: {
      kind: CatalogFeedEntry["type"];
      id: string;
      title: string;
      package: string;
      version: string;
      sourceRef: string;
      artifactDigest: string;
      sourceType: "clawhub" | "github" | "other";
      github: CatalogFeedInstallCandidate["github"] | null;
    };
    scanState: null;
    reviewState: null;
  };
  openclaw: {
    reviewState: OpenClawRegistryExportReflectedState | null;
    scanState: OpenClawRegistryExportReflectedState | null;
    registryState: OpenClawRegistryExportReflectedState | null;
    reviewId: string | null;
  };
};

function stableExportPart(value: string | number | null | undefined) {
  return encodeURIComponent(value == null ? "" : String(value));
}

function sourceTypeForCandidate(candidate: CatalogFeedInstallCandidate) {
  if (candidate.github) return "github" as const;
  if (candidate.sourceRef === "public-clawhub") return "clawhub" as const;
  return "other" as const;
}

function canonicalGitHubPart(candidate: CatalogFeedInstallCandidate) {
  const github = candidate.github;
  if (!github) return "";
  return [github.repo, github.path, github.commit, github.contentHash]
    .map(stableExportPart)
    .join(":");
}

function candidateKey(candidate: CatalogFeedInstallCandidate) {
  return [
    candidate.sourceRef,
    candidate.package,
    candidate.version,
    candidate.integrity,
    canonicalGitHubPart(candidate),
  ]
    .map(stableExportPart)
    .join(":");
}

export function buildOpenClawRegistryExport(
  input: OpenClawRegistryExportInput,
): OpenClawRegistryExport {
  if (!Number.isSafeInteger(input.feedSequence) || input.feedSequence < 0) {
    throw new Error("feedSequence must be a non-negative safe integer");
  }
  if (!Number.isFinite(Date.parse(input.exportedAt))) {
    throw new Error("exportedAt must be a valid ISO date");
  }

  const candidate = input.candidate ?? input.entry.install.candidates[0];
  if (!candidate) throw new Error("OpenClaw registry export requires an install candidate");
  if (
    input.candidate &&
    !input.entry.install.candidates.some(
      (entryCandidate) => candidateKey(entryCandidate) === candidateKey(candidate),
    )
  ) {
    throw new Error("OpenClaw registry export candidate must belong to the feed entry");
  }
  const idempotencyKey = [
    "openclaw-registry-export-v1",
    input.feedId,
    input.feedSequence,
    input.feedPayloadDigest ?? "",
    input.entry.type,
    input.entry.id,
    input.entry.version,
    candidate.sourceRef,
    candidate.package,
    candidate.version,
    candidate.integrity,
    canonicalGitHubPart(candidate),
  ]
    .map(stableExportPart)
    .join(":");

  return {
    schemaVersion: OPENCLAW_REGISTRY_EXPORT_SCHEMA_VERSION,
    exportId: idempotencyKey,
    idempotencyKey,
    exportedAt: input.exportedAt,
    exportActorId: input.exportActorId ?? null,
    clawhub: {
      feed: {
        id: input.feedId,
        sequence: input.feedSequence,
        payloadDigest: input.feedPayloadDigest ?? null,
        entryId: input.entry.id,
        entryState: input.entry.state,
      },
      publisher: {
        id: input.entry.publisher.id,
        official: input.entry.publisher.trust === "official",
      },
      candidate: {
        kind: input.entry.type,
        id: input.entry.id,
        title: input.entry.title,
        package: candidate.package,
        version: candidate.version,
        sourceRef: candidate.sourceRef,
        artifactDigest: candidate.integrity,
        sourceType: sourceTypeForCandidate(candidate),
        github: candidate.github ?? null,
      },
      scanState: null,
      reviewState: null,
    },
    openclaw: {
      reviewState: null,
      scanState: null,
      registryState: null,
      reviewId: null,
    },
  };
}
