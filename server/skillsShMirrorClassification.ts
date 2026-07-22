import { createHash } from "node:crypto";
import {
  CLASSIFIER_VERSION,
  TOPIC_CLASSIFIER_VERSION,
  classifySkill,
} from "../convex/lib/catalogClassifier.mjs";

const MAX_CLASSIFICATION_TEXT_LENGTH = 40_000;

type ClassificationConfidence = "high" | "medium" | "low";

type MirrorClassification = {
  inferredCategories: string[];
  inferredTopics: string[];
  inferredCategoryConfidence: ClassificationConfidence;
  inferredTopicConfidence: ClassificationConfidence;
  inferredClassifierVersion: string;
  inferredTopicClassifierVersion: string;
  inferredInputHash: string;
  inferredTopicInputHash: string;
  inferredAt: number;
};

export type SkillsShMirrorClassificationState = MirrorClassification & {
  externalId: string;
  slug: string;
  displayName: string;
  sourceContentHash?: string;
};

type ClassifiableMirrorRow = {
  quarantined?: never;
  externalId: string;
  slug: string;
  displayName: string;
  sourceContentHash?: string;
  detail?: { content: string };
};

type QuarantinedMirrorRow = {
  quarantined: true;
  externalId: string;
};

type MirrorReplayPair = {
  digest: {
    externalId: string;
    sourceType: "github" | "well-known";
    upstreamSourceType?: string;
    owner?: string;
    repo?: string;
    sourceHost?: string;
    slug: string;
    displayName: string;
    sourceUrl: string;
    canonicalRepoUrl?: string;
    githubPath?: string;
    githubCommit?: string;
    sourceContentHash?: string;
    upstreamInstalls: number;
    upstreamScanners: {
      genAgentTrustHub: { status: string; sourceCheckedAt?: string; sourceUrl?: string };
      socket: { status: string; sourceCheckedAt?: string; sourceUrl?: string };
      snyk: { status: string; sourceCheckedAt?: string; sourceUrl?: string };
    };
    inferredCategories?: string[];
    inferredTopics?: string[];
    inferredCategoryConfidence?: ClassificationConfidence;
    inferredTopicConfidence?: ClassificationConfidence;
    inferredClassifierVersion?: string;
    inferredTopicClassifierVersion?: string;
    inferredInputHash?: string;
    inferredTopicInputHash?: string;
    inferredAt?: number;
  };
  detail: {
    contentKind: "skill-md" | "readme";
    path: string;
    content: string;
    contentBytes: number;
    sourceBytes: number;
    sourceFileCount: number;
    truncated: boolean;
  } | null;
};

type ClassifierOutput = {
  categories: string[];
  topics: string[];
  confidence: ClassificationConfidence;
  topicConfidence: ClassificationConfidence;
  classifierVersion: string;
  topicClassifierVersion: string;
  inputHash: string;
  topicInputHash: string;
};

type EnrichedMirrorRow<T> = T extends QuarantinedMirrorRow ? T : T & MirrorClassification;

function hasReusableClassification(
  row: ClassifiableMirrorRow,
  state: SkillsShMirrorClassificationState | undefined,
): state is SkillsShMirrorClassificationState {
  return (
    state !== undefined &&
    state.slug === row.slug &&
    state.displayName === row.displayName &&
    (row.detail === undefined ||
      (row.sourceContentHash !== undefined && state.sourceContentHash === row.sourceContentHash)) &&
    state.inferredClassifierVersion === CLASSIFIER_VERSION &&
    state.inferredTopicClassifierVersion === TOPIC_CLASSIFIER_VERSION
  );
}

function boundedContentHash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function classificationText(row: ClassifiableMirrorRow) {
  const displayName = row.displayName.replace(/[\r\n]+/g, " ").trim() || row.slug;
  const content = row.detail?.content ?? `# ${displayName}`;
  return `---\nname: ${displayName}\n---\n${content}`.slice(0, MAX_CLASSIFICATION_TEXT_LENGTH);
}

export function enrichSkillsShMirrorClassifications<
  T extends ClassifiableMirrorRow | QuarantinedMirrorRow,
>(
  rows: T[],
  states: SkillsShMirrorClassificationState[],
  inferredAt = Date.now(),
  classify: (input: { slug?: string; text?: string }) => ClassifierOutput = classifySkill,
): Array<EnrichedMirrorRow<T>> {
  const statesByExternalId = new Map(states.map((state) => [state.externalId, state]));
  return rows.map((row) => {
    if ("quarantined" in row) return row;
    const state = statesByExternalId.get(row.externalId);
    if (hasReusableClassification(row, state)) {
      return {
        ...row,
        inferredCategories: state.inferredCategories,
        inferredTopics: state.inferredTopics,
        inferredCategoryConfidence: state.inferredCategoryConfidence,
        inferredTopicConfidence: state.inferredTopicConfidence,
        inferredClassifierVersion: state.inferredClassifierVersion,
        inferredTopicClassifierVersion: state.inferredTopicClassifierVersion,
        inferredInputHash: state.inferredInputHash,
        inferredTopicInputHash: state.inferredTopicInputHash,
        inferredAt: state.inferredAt,
      };
    }
    const result = classify({
      slug: row.slug,
      text: classificationText(row),
    });
    return {
      ...row,
      inferredCategories: result.categories.length > 0 ? result.categories : ["other"],
      inferredTopics: result.topics,
      inferredCategoryConfidence: result.confidence,
      inferredTopicConfidence: result.topicConfidence,
      inferredClassifierVersion: result.classifierVersion,
      inferredTopicClassifierVersion: result.topicClassifierVersion,
      inferredInputHash: result.inputHash,
      inferredTopicInputHash: result.topicInputHash,
      inferredAt,
    };
  }) as Array<EnrichedMirrorRow<T>>;
}

function replayClassificationState(
  digest: MirrorReplayPair["digest"],
): SkillsShMirrorClassificationState | null {
  if (
    !digest.inferredCategories ||
    !digest.inferredTopics ||
    !digest.inferredCategoryConfidence ||
    !digest.inferredTopicConfidence ||
    !digest.inferredClassifierVersion ||
    !digest.inferredTopicClassifierVersion ||
    !digest.inferredInputHash ||
    !digest.inferredTopicInputHash ||
    digest.inferredAt === undefined
  ) {
    return null;
  }
  return {
    externalId: digest.externalId,
    slug: digest.slug,
    displayName: digest.displayName,
    ...(digest.sourceContentHash ? { sourceContentHash: digest.sourceContentHash } : {}),
    inferredCategories: digest.inferredCategories,
    inferredTopics: digest.inferredTopics,
    inferredCategoryConfidence: digest.inferredCategoryConfidence,
    inferredTopicConfidence: digest.inferredTopicConfidence,
    inferredClassifierVersion: digest.inferredClassifierVersion,
    inferredTopicClassifierVersion: digest.inferredTopicClassifierVersion,
    inferredInputHash: digest.inferredInputHash,
    inferredTopicInputHash: digest.inferredTopicInputHash,
    inferredAt: digest.inferredAt,
  };
}

export function buildSkillsShMirrorReplayRows(pairs: MirrorReplayPair[], inferredAt = Date.now()) {
  const states = pairs.flatMap((pair) => {
    const state = replayClassificationState(pair.digest);
    return state ? [state] : [];
  });
  const rows = pairs.map(({ digest, detail }) => {
    const sourceContentHash =
      digest.sourceContentHash ?? (detail ? boundedContentHash(detail.content) : undefined);
    return {
      externalId: digest.externalId,
      sourceType: digest.sourceType,
      upstreamSourceType: digest.upstreamSourceType ?? digest.sourceType,
      ...(digest.owner ? { owner: digest.owner } : {}),
      ...(digest.repo ? { repo: digest.repo } : {}),
      ...(digest.sourceHost ? { sourceHost: digest.sourceHost } : {}),
      slug: digest.slug,
      displayName: digest.displayName,
      sourceUrl: digest.sourceUrl,
      ...(digest.canonicalRepoUrl ? { canonicalRepoUrl: digest.canonicalRepoUrl } : {}),
      ...(digest.githubPath ? { githubPath: digest.githubPath } : {}),
      ...(digest.githubCommit ? { githubCommit: digest.githubCommit } : {}),
      ...(sourceContentHash ? { sourceContentHash } : {}),
      upstreamInstalls: digest.upstreamInstalls,
      upstreamScanners: digest.upstreamScanners,
      ...(detail
        ? {
            detail: {
              contentKind: detail.contentKind,
              path: detail.path,
              content: detail.content,
              contentBytes: detail.contentBytes,
              sourceBytes: detail.sourceBytes,
              sourceFileCount: detail.sourceFileCount,
              truncated: detail.truncated,
            },
          }
        : {}),
    };
  });
  return enrichSkillsShMirrorClassifications(rows, states, inferredAt);
}
