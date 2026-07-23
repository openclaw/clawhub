export type BulkAdoptionCatalogEntry = {
  externalId: string;
  githubOwnerId: number;
  owner: string;
  repo: string;
  slug: string;
  displayName: string;
  sourceUrl: string;
  githubRepoUrl: string;
  githubPath?: string;
  githubCommit?: string;
  githubContentHash?: string;
  sourceContentHash: string;
};

export type BulkAdoptionDestination =
  | { kind: "none" }
  | {
      kind: "owned";
      skillId: string;
      ownerPublisherId: string;
      ownerHandle: string;
      slug: string;
      displayName: string;
      activeVersion?: string;
      unavailableReason?: string;
    }
  | {
      kind: "alias";
      skillId: string;
      ownerPublisherId: string;
      ownerHandle: string;
      slug: string;
      displayName: string;
    };

export type BulkAdoptionClassification =
  | "new-destination"
  | "replacement"
  | "unavailable"
  | "ownership-conflict";

export type BulkAdoptionPreviewItem = BulkAdoptionCatalogEntry & {
  publisherId: string;
  classification: BulkAdoptionClassification;
  eligible: boolean;
  reason?:
    | "missing-exact-source"
    | "destination-unavailable"
    | "destination-owned-by-another-publisher"
    | "destination-alias-conflict";
  destination: {
    skillId: string;
    ownerPublisherId: string;
    ownerHandle: string;
    slug: string;
    displayName: string;
    activeVersion?: string;
  } | null;
};

export type BulkAdoptionRequest = {
  publisherId: string;
  externalId: string;
  sourceContentHash: string;
  idempotencyKey: string;
};

export type BulkAdoptionProgress = {
  idempotencyKey: string;
  externalId: string;
  status: "completed" | "failed";
  attempts: number;
  adoptionId?: string;
  error?: string;
};

type StartAdoptionResult = {
  adoptionId: string;
};

function toDestinationSummary(
  destination: Exclude<BulkAdoptionDestination, { kind: "none" }>,
): NonNullable<BulkAdoptionPreviewItem["destination"]> {
  return {
    skillId: destination.skillId,
    ownerPublisherId: destination.ownerPublisherId,
    ownerHandle: destination.ownerHandle,
    slug: destination.slug,
    displayName: destination.displayName,
    ...("activeVersion" in destination && destination.activeVersion
      ? { activeVersion: destination.activeVersion }
      : {}),
  };
}

function hasExactSource(entry: BulkAdoptionCatalogEntry) {
  return Boolean(
    entry.externalId.trim() &&
    entry.githubCommit?.trim() &&
    entry.githubContentHash?.trim() &&
    entry.sourceContentHash.trim(),
  );
}

export function buildBulkAdoptionPreviewItem({
  publisherId,
  entry,
  destination,
}: {
  publisherId: string;
  entry: BulkAdoptionCatalogEntry;
  destination: BulkAdoptionDestination;
}): BulkAdoptionPreviewItem {
  if (!hasExactSource(entry)) {
    return {
      ...entry,
      publisherId,
      classification: "unavailable",
      eligible: false,
      reason: "missing-exact-source",
      destination: destination.kind === "none" ? null : toDestinationSummary(destination),
    };
  }
  if (destination.kind === "none") {
    return {
      ...entry,
      publisherId,
      classification: "new-destination",
      eligible: true,
      destination: null,
    };
  }
  if (destination.ownerPublisherId !== publisherId) {
    return {
      ...entry,
      publisherId,
      classification: "ownership-conflict",
      eligible: false,
      reason: "destination-owned-by-another-publisher",
      destination: toDestinationSummary(destination),
    };
  }
  if (destination.kind === "alias") {
    return {
      ...entry,
      publisherId,
      classification: "ownership-conflict",
      eligible: false,
      reason: "destination-alias-conflict",
      destination: toDestinationSummary(destination),
    };
  }
  if (destination.unavailableReason) {
    return {
      ...entry,
      publisherId,
      classification: "unavailable",
      eligible: false,
      reason: "destination-unavailable",
      destination: toDestinationSummary(destination),
    };
  }
  return {
    ...entry,
    publisherId,
    classification: "replacement",
    eligible: true,
    destination: toDestinationSummary(destination),
  };
}

function buildIdempotencyKey(publisherId: string, externalId: string, sourceContentHash: string) {
  return `skills-sh-adoption:v1:${publisherId}:${externalId}:${sourceContentHash}`;
}

function toRequest(publisherId: string, item: BulkAdoptionPreviewItem): BulkAdoptionRequest {
  if (item.publisherId !== publisherId) {
    throw new Error(`Cannot adopt skills.sh entry ${item.externalId} for a different publisher`);
  }
  if (!item.eligible) {
    throw new Error(`Cannot adopt ineligible skills.sh entry ${item.externalId}`);
  }
  return {
    publisherId,
    externalId: item.externalId,
    sourceContentHash: item.sourceContentHash,
    idempotencyKey: buildIdempotencyKey(publisherId, item.externalId, item.sourceContentHash),
  };
}

export function selectBulkAdoptionRequests({
  publisherId,
  preview,
  selection,
}: {
  publisherId: string;
  preview: BulkAdoptionPreviewItem[];
  selection:
    | { kind: "all-eligible" }
    | {
        kind: "entries";
        externalIds: string[];
      };
}) {
  if (selection.kind === "all-eligible") {
    return {
      requests: preview.filter((item) => item.eligible).map((item) => toRequest(publisherId, item)),
      rejected: [] as Array<{
        externalId: string;
        classification: BulkAdoptionClassification | "not-in-preview";
        reason: string;
      }>,
    };
  }

  const previewByExternalId = new Map(preview.map((item) => [item.externalId, item]));
  const requests: BulkAdoptionRequest[] = [];
  const rejected: Array<{
    externalId: string;
    classification: BulkAdoptionClassification | "not-in-preview";
    reason: string;
  }> = [];
  for (const externalId of new Set(selection.externalIds)) {
    const item = previewByExternalId.get(externalId);
    if (!item) {
      rejected.push({
        externalId,
        classification: "not-in-preview",
        reason: "entry-not-in-preview",
      });
      continue;
    }
    if (!item.eligible) {
      rejected.push({
        externalId,
        classification: item.classification,
        reason: item.reason ?? "entry-is-not-eligible",
      });
      continue;
    }
    requests.push(toRequest(publisherId, item));
  }
  return { requests, rejected };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function orderedProgress(
  requests: BulkAdoptionRequest[],
  progressByKey: Map<string, BulkAdoptionProgress>,
) {
  const requestKeys = new Set(requests.map((request) => request.idempotencyKey));
  return [
    ...requests
      .map((request) => progressByKey.get(request.idempotencyKey))
      .filter((item): item is BulkAdoptionProgress => Boolean(item)),
    ...[...progressByKey.values()].filter((item) => !requestKeys.has(item.idempotencyKey)),
  ];
}

function countRemaining(
  requests: BulkAdoptionRequest[],
  progressByKey: Map<string, BulkAdoptionProgress>,
) {
  return requests.filter(
    (request) => progressByKey.get(request.idempotencyKey)?.status !== "completed",
  ).length;
}

export async function orchestrateBulkAdoptionBatch({
  requests,
  progress,
  paused,
  maxItems,
  startAdoption,
}: {
  requests: BulkAdoptionRequest[];
  progress: BulkAdoptionProgress[];
  paused: boolean;
  maxItems: number;
  startAdoption: (request: BulkAdoptionRequest) => Promise<StartAdoptionResult>;
}) {
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) {
    throw new Error("maxItems must be an integer between 1 and 100");
  }
  const progressByKey = new Map(progress.map((item) => [item.idempotencyKey, item]));
  if (paused) {
    const remaining = countRemaining(requests, progressByKey);
    return {
      progress: orderedProgress(requests, progressByKey),
      attempted: 0,
      completed: 0,
      failed: 0,
      remaining,
      paused: true,
      done: remaining === 0,
    };
  }

  let attempted = 0;
  let completed = 0;
  for (const request of requests) {
    if (attempted >= maxItems) break;
    const previous = progressByKey.get(request.idempotencyKey);
    if (previous?.status === "completed") continue;

    attempted += 1;
    try {
      const result = await startAdoption(request);
      completed += 1;
      progressByKey.set(request.idempotencyKey, {
        idempotencyKey: request.idempotencyKey,
        externalId: request.externalId,
        status: "completed",
        attempts: (previous?.attempts ?? 0) + 1,
        adoptionId: result.adoptionId,
      });
    } catch (error) {
      progressByKey.set(request.idempotencyKey, {
        idempotencyKey: request.idempotencyKey,
        externalId: request.externalId,
        status: "failed",
        attempts: (previous?.attempts ?? 0) + 1,
        error: errorMessage(error),
      });
      const remaining = countRemaining(requests, progressByKey);
      return {
        progress: orderedProgress(requests, progressByKey),
        attempted,
        completed,
        failed: 1,
        remaining,
        paused: true,
        done: false,
      };
    }
  }

  const remaining = countRemaining(requests, progressByKey);
  return {
    progress: orderedProgress(requests, progressByKey),
    attempted,
    completed,
    failed: 0,
    remaining,
    paused: false,
    done: remaining === 0,
  };
}
