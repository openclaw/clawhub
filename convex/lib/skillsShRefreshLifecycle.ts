export type SkillsShSourcePointer = {
  externalId: string;
  githubOwnerId?: number;
  owner?: string;
  repo?: string;
  slug?: string;
  githubPath?: string;
  githubCommit?: string;
  githubContentHash?: string;
  sourceContentHash: string;
};

export type SkillsShMirroredSnapshot = SkillsShSourcePointer & {
  observationVersion: number;
  presence: "present" | "deleted" | "redirect";
  sourceUrl: string;
  redirectExternalId?: string;
};

export type SkillsShMirroredRefreshDecision = {
  kind:
    | "insert"
    | "update"
    | "unchanged"
    | "stale"
    | "conflict"
    | "delete"
    | "reappear"
    | "redirect";
  scanRequired: false;
  snapshot: SkillsShMirroredSnapshot;
};

function sameMirroredSnapshot(left: SkillsShMirroredSnapshot, right: SkillsShMirroredSnapshot) {
  return (
    left.externalId === right.externalId &&
    left.observationVersion === right.observationVersion &&
    left.presence === right.presence &&
    left.sourceUrl === right.sourceUrl &&
    left.githubPath === right.githubPath &&
    left.githubCommit === right.githubCommit &&
    left.githubContentHash === right.githubContentHash &&
    left.sourceContentHash === right.sourceContentHash &&
    left.redirectExternalId === right.redirectExternalId
  );
}

export function decideMirroredRefresh(args: {
  current?: SkillsShMirroredSnapshot;
  observed: SkillsShMirroredSnapshot;
}): SkillsShMirroredRefreshDecision {
  if (!args.current) {
    return { kind: "insert", scanRequired: false, snapshot: args.observed };
  }
  if (args.observed.observationVersion < args.current.observationVersion) {
    return { kind: "stale", scanRequired: false, snapshot: args.current };
  }
  if (sameMirroredSnapshot(args.current, args.observed)) {
    return { kind: "unchanged", scanRequired: false, snapshot: args.current };
  }
  if (args.observed.observationVersion === args.current.observationVersion) {
    return { kind: "conflict", scanRequired: false, snapshot: args.current };
  }
  if (args.observed.presence === "deleted") {
    return { kind: "delete", scanRequired: false, snapshot: args.observed };
  }
  if (args.observed.presence === "redirect") {
    return { kind: "redirect", scanRequired: false, snapshot: args.observed };
  }
  if (args.current.presence !== "present") {
    return { kind: "reappear", scanRequired: false, snapshot: args.observed };
  }
  return { kind: "update", scanRequired: false, snapshot: args.observed };
}

export function hasSameAdoptedContent(left: SkillsShSourcePointer, right: SkillsShSourcePointer) {
  return (
    left.externalId === right.externalId &&
    left.githubOwnerId === right.githubOwnerId &&
    left.owner === right.owner &&
    left.repo === right.repo &&
    left.slug === right.slug &&
    left.sourceContentHash === right.sourceContentHash &&
    left.githubContentHash === right.githubContentHash
  );
}

export function shouldPromoteAdoptedCandidate(args: {
  current: SkillsShSourcePointer;
  candidate: SkillsShSourcePointer;
  verdict: "clean" | "suspicious" | "malicious" | "failed";
}) {
  return (
    (args.verdict === "clean" || args.verdict === "suspicious") &&
    hasSameAdoptedContent(args.current, args.candidate)
  );
}

export function resolveAdoptedActiveSource(args: {
  current: SkillsShSourcePointer;
  active: SkillsShSourcePointer;
}) {
  return args.active;
}
