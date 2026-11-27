import { createHash } from "node:crypto";

// Hard capacity for any measured skills.sh source and proof snapshot. The source acquisition window
// must stay inside it; Convex enforces the same capacity on run totals and cursors.
export const MAX_PROOF_SOURCE_ROWS = 50_000;
const MAX_PROOF_SNAPSHOT_BYTES = 32 * 1024;

export const SKILLS_SH_MIRROR_CONTROLLED_SUPPLEMENTS = [
  {
    externalId: "patrick-erichsen/skills/html",
    owner: "patrick-erichsen",
    repo: "skills",
    slug: "html",
    displayName: "HTML Artifact Chooser",
    sourceUrl: "https://www.skills.sh/patrick-erichsen/skills/html",
    githubPath: "skills/html",
    detailPath: "skills/html/SKILL.md",
    githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
    sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
    detailContentHash: "42d2e89358ea927441dfede45c3b0cf89a21603bc7c32246f098d24a9cbea1ff",
  },
  {
    externalId: "steipete/clawdis/discrawl",
    owner: "steipete",
    repo: "clawdis",
    slug: "discrawl",
    displayName: "Discrawl",
    sourceUrl: "https://www.skills.sh/steipete/clawdis/discrawl",
    githubPath: ".agents/skills/discrawl",
    detailPath: ".agents/skills/discrawl/SKILL.md",
    githubCommit: "690ed564419291ca6e832dc69b53061300075b62",
    sourceContentHash: "4d3c90262b309ee9ee0ef2f83397fc2a68e8c7d098a8a960fdcbf8908f077f10",
    detailContentHash: "889dc43180b210dbca12f8291e007feb231250ecfdba90c4d3938a18125efb6d",
  },
] as const;

export const SKILLS_SH_MIRROR_CONTROLLED_EXTERNAL_IDS = SKILLS_SH_MIRROR_CONTROLLED_SUPPLEMENTS.map(
  (row) => row.externalId,
);
const SKILLS_SH_MIRROR_PROOF_SNAPSHOT_PREFIX = "skills-sh:proof:";

export function normalizeControlledSupplementIds(values: unknown[]) {
  const allowed = new Set<string>(SKILLS_SH_MIRROR_CONTROLLED_EXTERNAL_IDS);
  const normalized = values.map((value) =>
    typeof value === "string" ? value.trim().toLowerCase() : "",
  );
  if (
    normalized.some((value) => !allowed.has(value)) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error("skills.sh mirror controlled identities are invalid");
  }
  return SKILLS_SH_MIRROR_CONTROLLED_EXTERNAL_IDS.filter((externalId) =>
    normalized.includes(externalId),
  );
}

export function buildSkillsShMirrorProofSnapshotId(args: {
  catalogTotal: number;
  controlledExternalIds: string[];
  controlledOverlayExternalIds?: string[];
  controlledSupplementExternalIds?: string[];
  evidence?: SkillsShMirrorProofEvidence;
}) {
  assertIntegerInRange("catalogTotal", args.catalogTotal, 1, MAX_PROOF_SOURCE_ROWS);
  const controlledExternalIds = normalizeControlledSupplementIds(args.controlledExternalIds);
  const controlledOverlayExternalIds = normalizeControlledSupplementIds(
    args.controlledOverlayExternalIds ?? [],
  );
  const controlledSupplementExternalIds = normalizeControlledSupplementIds(
    args.controlledSupplementExternalIds ?? controlledExternalIds,
  );
  if (
    controlledOverlayExternalIds.some((externalId) =>
      controlledSupplementExternalIds.includes(externalId),
    ) ||
    controlledExternalIds.some(
      (externalId) =>
        !controlledOverlayExternalIds.includes(externalId) &&
        !controlledSupplementExternalIds.includes(externalId),
    ) ||
    controlledOverlayExternalIds.some(
      (externalId) => !controlledExternalIds.includes(externalId),
    ) ||
    controlledSupplementExternalIds.some(
      (externalId) => !controlledExternalIds.includes(externalId),
    )
  ) {
    throw new Error("skills.sh mirror controlled proof partition is invalid");
  }
  const encodedPayload = Buffer.from(
    JSON.stringify({
      catalogTotal: args.catalogTotal,
      controlledExternalIds,
      controlledOverlayExternalIds,
      controlledSupplementExternalIds,
    }),
  ).toString("base64url");
  const compact = `${SKILLS_SH_MIRROR_PROOF_SNAPSHOT_PREFIX}${encodedPayload}`;
  if (!args.evidence) return compact;
  const evidence = validateSkillsShMirrorProofEvidence(args.evidence);
  const serializedEvidence = JSON.stringify(evidence);
  const snapshotId =
    `${compact}.${sha256Hex(`${encodedPayload}.${serializedEvidence}`)}.` +
    Buffer.from(serializedEvidence).toString("base64url");
  if (Buffer.byteLength(snapshotId, "utf8") > MAX_PROOF_SNAPSHOT_BYTES) {
    throw new Error("skills.sh mirror proof source metadata is too large");
  }
  return snapshotId;
}

export function parseSkillsShMirrorProofSnapshotId(snapshotId: string) {
  if (!snapshotId.startsWith(SKILLS_SH_MIRROR_PROOF_SNAPSHOT_PREFIX)) {
    throw new Error("skills.sh mirror run lacks proof source metadata");
  }
  let payload: unknown;
  let evidence: SkillsShMirrorProofEvidence | undefined;
  let sourceSnapshotHash: string | undefined;
  try {
    const [encodedPayload, snapshotHash, encodedEvidence, ...unexpected] = snapshotId
      .slice(SKILLS_SH_MIRROR_PROOF_SNAPSHOT_PREFIX.length)
      .split(".");
    if (
      unexpected.length > 0 ||
      (snapshotHash !== undefined && encodedEvidence === undefined) ||
      (snapshotHash === undefined && encodedEvidence !== undefined)
    ) {
      throw new Error("invalid proof snapshot segments");
    }
    payload = JSON.parse(Buffer.from(encodedPayload ?? "", "base64url").toString("utf8"));
    if (snapshotHash && encodedEvidence) {
      const serializedEvidence = Buffer.from(encodedEvidence, "base64url").toString("utf8");
      if (
        !/^[a-f0-9]{64}$/.test(snapshotHash) ||
        sha256Hex(`${encodedPayload}.${serializedEvidence}`) !== snapshotHash
      ) {
        throw new Error("invalid proof snapshot hash");
      }
      evidence = validateSkillsShMirrorProofEvidence(JSON.parse(serializedEvidence));
      sourceSnapshotHash = snapshotHash;
    }
  } catch {
    throw new Error("skills.sh mirror proof source metadata is invalid");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("skills.sh mirror proof source metadata is invalid");
  }
  const record = payload as Record<string, unknown>;
  if (
    !Number.isInteger(record.catalogTotal) ||
    Number(record.catalogTotal) < 1 ||
    Number(record.catalogTotal) > MAX_PROOF_SOURCE_ROWS
  ) {
    throw new Error("skills.sh mirror proof catalog total is invalid");
  }
  if (!Array.isArray(record.controlledExternalIds)) {
    throw new Error("skills.sh mirror proof controlled identities are invalid");
  }
  const controlledExternalIds = normalizeControlledSupplementIds(record.controlledExternalIds);
  const controlledOverlayExternalIds = normalizeControlledSupplementIds(
    Array.isArray(record.controlledOverlayExternalIds) ? record.controlledOverlayExternalIds : [],
  );
  const controlledSupplementExternalIds = normalizeControlledSupplementIds(
    Array.isArray(record.controlledSupplementExternalIds)
      ? record.controlledSupplementExternalIds
      : controlledExternalIds,
  );
  buildSkillsShMirrorProofSnapshotId({
    catalogTotal: Number(record.catalogTotal),
    controlledExternalIds,
    controlledOverlayExternalIds,
    controlledSupplementExternalIds,
  });
  return {
    catalogTotal: Number(record.catalogTotal),
    controlledExternalIds,
    controlledOverlayExternalIds,
    controlledSupplementExternalIds,
    ...(sourceSnapshotHash ? { sourceSnapshotHash } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

export type SkillsShCatalogPagination = {
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};

export type SkillsShSourceWindow = {
  rows: number;
  upstreamTotal: number;
  truncated: boolean;
};

export type SkillsShMirrorProofEvidence = {
  pagination: {
    // False when the upstream total exceeded the mirror window and measurement stopped there.
    endpointExhausted: boolean;
    window?: SkillsShSourceWindow;
    databaseCoverage: "leaderboard-only";
    page0: SkillsShCatalogPagination;
    requestedPages: Array<{
      page: number;
      count: number;
      hasMore: boolean;
      identityHash: string;
      contentHash: string;
      sourceBytes?: number;
      serializedBytes?: number;
    }>;
    finalNonemptyPage: {
      page: number;
      count: number;
      pagination: SkillsShCatalogPagination;
    };
    firstBeyondEndPage: {
      page: number;
      count: number;
      pagination: SkillsShCatalogPagination;
    } | null;
    uniqueIds: number;
    duplicateIds: number;
  };
  fields: {
    sampledExternalId: string;
    leaderboard: {
      topLevelKeys: string[];
      paginationKeys: string[];
      rowKeys: string[];
      taxonomyFields: string[];
    };
    search: {
      topLevelKeys: string[];
      rowKeys: string[];
      taxonomyFields: string[];
    };
    detail: {
      topLevelKeys: string[];
      fileKeys: string[];
      taxonomyFields: string[];
    };
    page: {
      url: string;
      jsonLdDocuments: Array<{ type: string | null; keys: string[] }>;
      taxonomyFields: string[];
    };
    rsc: {
      objectKeys: string[];
      taxonomyFields: string[];
    };
    normalizedUpstreamTaxonomyFields: string[];
  };
};

function validateSkillsShMirrorProofEvidence(value: unknown): SkillsShMirrorProofEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("skills.sh mirror proof evidence is invalid");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROOF_SNAPSHOT_BYTES) {
    throw new Error("skills.sh mirror proof evidence is too large");
  }
  const record = value as Record<string, unknown>;
  if (
    !record.pagination ||
    typeof record.pagination !== "object" ||
    Array.isArray(record.pagination) ||
    !record.fields ||
    typeof record.fields !== "object" ||
    Array.isArray(record.fields)
  ) {
    throw new Error("skills.sh mirror proof evidence is invalid");
  }
  return value as SkillsShMirrorProofEvidence;
}

function assertIntegerInRange(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

function sha256Hex(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}
