import { createHash } from "node:crypto";
import { redactBundleContent } from "../security-dataset/normalize";

export type SnapshotDocument = Record<string, unknown> & {
  _creationTime: number;
  _id: string;
};

export type SnapshotFile = {
  contentType?: string;
  path: string;
  sha256: string;
  size: number;
  storageId: string;
};

const LOCAL_PATH_PATTERNS = [
  /\/Users\/[^\r\n"'`<>]*/g,
  /\/var\/folders\/[^\r\n"'`<>]*/g,
  /\/private\/tmp\/[^\r\n"'`<>]*/g,
  /C:\\Users\\[^\r\n"'`<>]*/gi,
];

export function isPublicSkillSnapshot(doc: SnapshotDocument) {
  if (doc.softDeletedAt) return false;
  if (doc.moderationStatus && doc.moderationStatus !== "active") return false;
  if (doc.moderationVerdict === "malicious") return false;
  return !asStringArray(doc.moderationFlags).includes("blocked.malware");
}

export function isPublicPackageSnapshot(doc: SnapshotDocument) {
  if (doc.softDeletedAt) return false;
  if (doc.channel === "private") return false;
  if (doc.family !== "code-plugin" && doc.family !== "bundle-plugin") return false;
  return doc.scanStatus !== "malicious";
}

export function dummyIdentity(sourceId: string, kind: "user" | "publisher") {
  const digest = createHash("sha256").update(`${kind}:${sourceId}`).digest("hex").slice(0, 12);
  return {
    handle: `test-snapshot-${kind}-${digest}`,
    displayName: `Test Snapshot ${kind === "user" ? "User" : "Publisher"} ${digest.slice(0, 6)}`,
    image: `https://api.dicebear.com/9.x/shapes/svg?seed=${digest}`,
  };
}

export function sanitizeUserSnapshot(
  doc: SnapshotDocument,
  personalPublisherIds: ReadonlySet<string>,
): SnapshotDocument {
  const identity = dummyIdentity(doc._id, "user");
  const personalPublisherId =
    typeof doc.personalPublisherId === "string" && personalPublisherIds.has(doc.personalPublisherId)
      ? doc.personalPublisherId
      : undefined;
  return compact({
    _id: doc._id,
    _creationTime: doc._creationTime,
    handle: identity.handle,
    displayName: identity.displayName,
    name: identity.displayName,
    image: identity.image,
    role: "user",
    personalPublisherId,
    createdAt: numberOr(doc.createdAt, doc._creationTime),
    updatedAt: numberOr(doc.updatedAt, doc._creationTime),
  });
}

export function sanitizePublisherSnapshot(
  doc: SnapshotDocument,
  linkedUserIds: ReadonlySet<string>,
): SnapshotDocument {
  const identity = dummyIdentity(doc._id, "publisher");
  const linkedUserId =
    typeof doc.linkedUserId === "string" && linkedUserIds.has(doc.linkedUserId)
      ? doc.linkedUserId
      : undefined;
  return compact({
    _id: doc._id,
    _creationTime: doc._creationTime,
    kind: doc.kind === "org" ? "org" : "user",
    handle: identity.handle,
    displayName: identity.displayName,
    image: identity.image,
    linkedUserId,
    trustedPublisher: doc.trustedPublisher === true ? true : undefined,
    publishedSkills: finiteNumber(doc.publishedSkills),
    publishedPackages: finiteNumber(doc.publishedPackages),
    totalInstalls: finiteNumber(doc.totalInstalls),
    totalDownloads: finiteNumber(doc.totalDownloads),
    totalStars: finiteNumber(doc.totalStars),
    skillTotalInstalls: finiteNumber(doc.skillTotalInstalls),
    skillTotalDownloads: finiteNumber(doc.skillTotalDownloads),
    skillTotalStars: finiteNumber(doc.skillTotalStars),
    createdAt: numberOr(doc.createdAt, doc._creationTime),
    updatedAt: numberOr(doc.updatedAt, doc._creationTime),
  });
}

export function sanitizePublicText(value: string) {
  let redacted = value;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = redactBundleContent(redacted);
    if (next === redacted) break;
    redacted = next;
  }
  for (const pattern of LOCAL_PATH_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_PATH]");
  }
  return redacted;
}

export function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizePublicText(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/(?:email|phone|token|secret|password|authorization|githubId|oauth|ipAddress)/i.test(
            key,
          ),
      )
      .map(([key, child]) => [key, sanitizeJsonValue(child)]),
  );
}

export function publicSkillFields(doc: SnapshotDocument) {
  return compact({
    _id: doc._id,
    _creationTime: doc._creationTime,
    slug: doc.slug,
    displayName: sanitizeOptionalText(doc.displayName),
    summary: sanitizeOptionalText(doc.summary),
    ownerUserId: doc.ownerUserId,
    ownerPublisherId: doc.ownerPublisherId,
    latestVersionId: doc.latestVersionId,
    latestVersionSummary: sanitizeJsonValue(doc.latestVersionSummary),
    tags:
      typeof doc.latestVersionId === "string" ? { latest: doc.latestVersionId } : ({} as object),
    categories: doc.categories,
    topics: doc.topics,
    inferredCategories: doc.inferredCategories,
    inferredTopics: doc.inferredTopics,
    inferredCategoryConfidence: doc.inferredCategoryConfidence,
    inferredTopicConfidence: doc.inferredTopicConfidence,
    inferredClassifierVersion: doc.inferredClassifierVersion,
    inferredTopicClassifierVersion: doc.inferredTopicClassifierVersion,
    inferredInputHash: doc.inferredInputHash,
    inferredTopicInputHash: doc.inferredTopicInputHash,
    inferredAt: doc.inferredAt,
    moderationStatus: "active",
    moderationVerdict: doc.moderationVerdict === "suspicious" ? "suspicious" : undefined,
    moderationSummary: sanitizeOptionalText(doc.moderationSummary),
    moderationEngineVersion: doc.moderationEngineVersion,
    moderationEvaluatedAt: doc.moderationEvaluatedAt,
    isSuspicious: doc.isSuspicious === true ? true : undefined,
    quality: sanitizeJsonValue(doc.quality),
    batch: "staging-prod-snapshot-v1",
    statsDownloads: finiteNumber(doc.statsDownloads),
    statsStars: finiteNumber(doc.statsStars),
    statsInstallsCurrent: finiteNumber(doc.statsInstallsCurrent),
    statsInstallsAllTime: finiteNumber(doc.statsInstallsAllTime),
    stats: sanitizeJsonValue(doc.stats),
    createdAt: numberOr(doc.createdAt, doc._creationTime),
    updatedAt: numberOr(doc.updatedAt, doc._creationTime),
  });
}

export function publicPackageFields(doc: SnapshotDocument) {
  return compact({
    _id: doc._id,
    _creationTime: doc._creationTime,
    name: doc.name,
    normalizedName: doc.normalizedName,
    displayName: sanitizeOptionalText(doc.displayName),
    summary: sanitizeOptionalText(doc.summary),
    ownerUserId: doc.ownerUserId,
    ownerPublisherId: doc.ownerPublisherId,
    family: doc.family,
    channel: doc.channel,
    isOfficial: doc.isOfficial === true,
    runtimeId: doc.runtimeId,
    sourceRepo: sanitizeOptionalText(doc.sourceRepo),
    latestReleaseId: doc.latestReleaseId,
    latestVersionSummary: sanitizeJsonValue(doc.latestVersionSummary),
    tags:
      typeof doc.latestReleaseId === "string" ? { latest: doc.latestReleaseId } : ({} as object),
    categories: doc.categories,
    topics: doc.topics,
    inferredCategories: doc.inferredCategories,
    inferredTopics: doc.inferredTopics,
    inferredCategoryConfidence: doc.inferredCategoryConfidence,
    inferredTopicConfidence: doc.inferredTopicConfidence,
    inferredClassifierVersion: doc.inferredClassifierVersion,
    inferredTopicClassifierVersion: doc.inferredTopicClassifierVersion,
    inferredInputHash: doc.inferredInputHash,
    inferredTopicInputHash: doc.inferredTopicInputHash,
    inferredAt: doc.inferredAt,
    compatibility: sanitizeJsonValue(doc.compatibility),
    verification: sanitizeJsonValue(doc.verification),
    scanStatus: doc.scanStatus,
    stats: sanitizeJsonValue(doc.stats),
    recommendedScore: finiteNumber(doc.recommendedScore),
    recommendedScoreVersion: finiteNumber(doc.recommendedScoreVersion),
    createdAt: numberOr(doc.createdAt, doc._creationTime),
    updatedAt: numberOr(doc.updatedAt, doc._creationTime),
  });
}

export function publicSkillVersionFields(
  doc: SnapshotDocument,
  ownerUserId: string,
  files: SnapshotFile[],
) {
  return compact({
    _id: doc._id,
    _creationTime: doc._creationTime,
    skillId: doc.skillId,
    version: doc.version,
    changelog:
      sanitizeOptionalText(doc.changelog) ?? "Imported from a sanitized production snapshot.",
    changelogSource: doc.changelogSource,
    icon: sanitizeOptionalText(doc.icon),
    files,
    parsed: sanitizeJsonValue(doc.parsed) ?? { frontmatter: {} },
    createdBy: ownerUserId,
    createdAt: numberOr(doc.createdAt, doc._creationTime),
  });
}

export function publicPackageReleaseFields(
  doc: SnapshotDocument,
  ownerUserId: string,
  files: SnapshotFile[],
) {
  return compact({
    _id: doc._id,
    _creationTime: doc._creationTime,
    packageId: doc.packageId,
    version: doc.version,
    changelog:
      sanitizeOptionalText(doc.changelog) ?? "Imported from a sanitized production snapshot.",
    summary: sanitizeOptionalText(doc.summary),
    icon: sanitizeOptionalText(doc.icon),
    distTags: Array.isArray(doc.distTags) ? doc.distTags : ["latest"],
    files,
    integritySha256: doc.integritySha256,
    extractedPackageJson: sanitizeJsonValue(doc.extractedPackageJson),
    extractedPluginManifest: sanitizeJsonValue(doc.extractedPluginManifest),
    normalizedBundleManifest: sanitizeJsonValue(doc.normalizedBundleManifest),
    pluginManifestSummary: sanitizeJsonValue(doc.pluginManifestSummary),
    compatibility: sanitizeJsonValue(doc.compatibility),
    runtimeId: doc.runtimeId,
    sourceRepo: sanitizeOptionalText(doc.sourceRepo),
    verification: sanitizeJsonValue(doc.verification),
    source: sanitizeJsonValue(doc.source),
    createdBy: ownerUserId,
    publishActor: { kind: "user", userId: ownerUserId },
    createdAt: numberOr(doc.createdAt, doc._creationTime),
  });
}

export function selectSkillSnapshotFiles(value: unknown): SnapshotFile[] {
  return asSnapshotFiles(value)
    .filter((file) => file.path.toLowerCase() === "skill.md")
    .slice(0, 1);
}

export function selectPackageSnapshotFiles(value: unknown): SnapshotFile[] {
  const files = asSnapshotFiles(value)
    .filter((file) => isAllowedPackageArtifact(file.path) && file.size <= 256 * 1024)
    .sort((left, right) => packageFilePriority(left.path) - packageFilePriority(right.path));
  const selected: SnapshotFile[] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (selected.length >= 16 || totalBytes + file.size > 1024 * 1024) continue;
    selected.push(file);
    totalBytes += file.size;
  }
  return selected;
}

export function sanitizeDerivedSnapshot(
  doc: SnapshotDocument,
  parent: SnapshotDocument,
  kind: "skill" | "package",
): SnapshotDocument {
  const sanitized = sanitizeJsonValue(doc) as SnapshotDocument;
  const ownerId =
    typeof parent.ownerPublisherId === "string" ? parent.ownerPublisherId : parent.ownerUserId;
  const ownerKind = typeof parent.ownerPublisherId === "string" ? "publisher" : "user";
  const owner = typeof ownerId === "string" ? dummyIdentity(ownerId, ownerKind) : undefined;
  if (owner) {
    if ("ownerHandle" in sanitized) sanitized.ownerHandle = owner.handle;
    if ("ownerName" in sanitized) sanitized.ownerName = owner.displayName;
    if ("ownerDisplayName" in sanitized) sanitized.ownerDisplayName = owner.displayName;
    if ("ownerImage" in sanitized) sanitized.ownerImage = owner.image;
  }
  delete sanitized.badges;
  if (kind === "skill" && typeof parent.latestVersionId === "string") {
    if ("latestVersionId" in sanitized) sanitized.latestVersionId = parent.latestVersionId;
    if ("latestVersionSkillId" in sanitized) sanitized.latestVersionSkillId = parent._id;
    if ("tags" in sanitized) sanitized.tags = { latest: parent.latestVersionId };
  }
  if (kind === "package" && typeof parent.latestReleaseId === "string" && "tags" in sanitized) {
    sanitized.tags = { latest: parent.latestReleaseId };
  }
  return sanitized;
}

function sanitizeOptionalText(value: unknown) {
  return typeof value === "string" ? sanitizePublicText(value) : undefined;
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asSnapshotFiles(value: unknown): SnapshotFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SnapshotFile => {
    if (!isRecord(item)) return false;
    return (
      typeof item.path === "string" &&
      typeof item.size === "number" &&
      typeof item.storageId === "string" &&
      typeof item.sha256 === "string"
    );
  });
}

function isAllowedPackageArtifact(path: string) {
  const normalized = path.toLowerCase().replace(/^\.\//, "");
  return (
    normalized === "readme.md" ||
    normalized === "readme.markdown" ||
    normalized === "package.json" ||
    normalized === "openclaw.plugin.json" ||
    normalized === "skill.md" ||
    normalized.endsWith("/skill.md")
  );
}

function packageFilePriority(path: string) {
  const normalized = path.toLowerCase();
  const basename = normalized.split("/").at(-1) ?? normalized;
  if (basename === "readme.md" || basename === "readme.markdown") return 0;
  if (basename === "package.json") return 1;
  if (basename === "openclaw.plugin.json") return 2;
  if (basename === "skill.md") return 3;
  return 4;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}
