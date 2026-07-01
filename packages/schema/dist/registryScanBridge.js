export const OPENCLAW_REGISTRY_EXPORT_SCHEMA_VERSION = 1;
function stableExportPart(value) {
    return encodeURIComponent(value == null ? "" : String(value));
}
function sourceTypeForCandidate(candidate) {
    if (candidate.github)
        return "github";
    if (candidate.sourceRef === "public-clawhub")
        return "clawhub";
    return "other";
}
function canonicalGitHubPart(candidate) {
    const github = candidate.github;
    if (!github)
        return "";
    return [github.repo, github.path, github.commit, github.contentHash]
        .map(stableExportPart)
        .join(":");
}
function candidateKey(candidate) {
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
export function buildOpenClawRegistryExport(input) {
    if (!Number.isSafeInteger(input.feedSequence) || input.feedSequence < 0) {
        throw new Error("feedSequence must be a non-negative safe integer");
    }
    if (!Number.isFinite(Date.parse(input.exportedAt))) {
        throw new Error("exportedAt must be a valid ISO date");
    }
    const candidate = input.candidate ?? input.entry.install.candidates[0];
    if (!candidate)
        throw new Error("OpenClaw registry export requires an install candidate");
    if (input.candidate &&
        !input.entry.install.candidates.some((entryCandidate) => candidateKey(entryCandidate) === candidateKey(candidate))) {
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
//# sourceMappingURL=registryScanBridge.js.map
