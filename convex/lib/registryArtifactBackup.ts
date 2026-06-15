"use node";

import { createHash, createHmac } from "node:crypto";
import semver from "semver";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { validateFilePath } from "./skillZip";

const DEFAULT_SKILLS_ROOT = "skills";
const DEFAULT_PACKAGES_ROOT = "packages";
const META_FILENAME = "_meta.json";
const INDEX_FILENAME = "_index.json";
const MAX_INDEX_WRITE_ATTEMPTS = 5;
const MIN_INDEX_WRITE_RETRY_DELAY_MS = 25;
const MAX_INDEX_WRITE_RETRY_DELAY_MS = 250;

type BackupFile = {
  path: string;
  size: number;
  storageId: Id<"_storage">;
  sha256: string;
  contentType?: string;
};

type SkillBackupParams = {
  skillId?: Id<"skills">;
  versionId?: Id<"skillVersions">;
  slug: string;
  version: string;
  isLatest?: boolean;
  displayName: string;
  ownerHandle: string;
  files: BackupFile[];
  publishedAt: number;
};

type PackageBackupParams = {
  ownerHandle: string;
  packageId: Id<"packages">;
  releaseId: Id<"packageReleases">;
  packageName: string;
  normalizedName: string;
  displayName: string;
  family: "code-plugin" | "bundle-plugin";
  version: string;
  isLatest?: boolean;
  publishedAt: number;
  artifactKind?: "legacy-zip" | "npm-pack";
  artifactFileName?: string;
  artifactSha256?: string;
  artifactSize?: number;
  artifactFormat?: "tgz";
  npmIntegrity?: string;
  npmShasum?: string;
  npmUnpackedSize?: number;
  npmFileCount?: number;
  runtimeId?: string;
  sourceRepo?: string;
  compatibility?: unknown;
  capabilities?: unknown;
  extractedPackageJson?: unknown;
  extractedPluginManifest?: unknown;
  normalizedBundleManifest?: unknown;
  files: Array<{ path: string; size: number; sha256: string }>;
};

type VersionIndexEntry = {
  version: string;
  isLatest?: boolean;
  publishedAt: number;
  path: string;
};

type SkillIndexEntry = VersionIndexEntry & {
  skillId?: Id<"skills">;
  versionId?: Id<"skillVersions">;
};

type PackageIndexEntry = VersionIndexEntry & {
  packageId: Id<"packages">;
  releaseId: Id<"packageReleases">;
};

type SkillIndexFile = {
  kind: "skill";
  owner: string;
  slug: string;
  displayName: string;
  latest: SkillIndexEntry;
  versions: SkillIndexEntry[];
};

type PackageIndexFile = {
  kind: "package";
  owner: string;
  packageName: string;
  normalizedName: string;
  displayName: string;
  family: PackageBackupParams["family"];
  latest: PackageIndexEntry;
  versions: PackageIndexEntry[];
};

export type RegistryArtifactBackupContext = RegistryArtifactBackupSettings;

export type RegistryArtifactBackupSettings = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  skillsRoot: string;
  packagesRoot: string;
};

export function isRegistryArtifactBackupConfigured() {
  return Boolean(
    (process.env.REGISTRY_BACKUP_S3_ENDPOINT || process.env.REGISTRY_BACKUP_R2_ACCOUNT_ID) &&
    process.env.REGISTRY_BACKUP_BUCKET &&
    process.env.REGISTRY_BACKUP_ACCESS_KEY_ID &&
    process.env.REGISTRY_BACKUP_SECRET_ACCESS_KEY,
  );
}

export function getRegistryArtifactBackupSettings(): RegistryArtifactBackupSettings {
  const endpoint =
    process.env.REGISTRY_BACKUP_S3_ENDPOINT ??
    r2EndpointFromAccountId(process.env.REGISTRY_BACKUP_R2_ACCOUNT_ID);
  if (!endpoint) {
    throw new Error("REGISTRY_BACKUP_S3_ENDPOINT or REGISTRY_BACKUP_R2_ACCOUNT_ID is required");
  }
  const bucket = requiredEnv("REGISTRY_BACKUP_BUCKET");
  const accessKeyId = requiredEnv("REGISTRY_BACKUP_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("REGISTRY_BACKUP_SECRET_ACCESS_KEY");
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.REGISTRY_BACKUP_S3_REGION ?? "auto",
    skillsRoot: process.env.REGISTRY_BACKUP_SKILLS_ROOT ?? DEFAULT_SKILLS_ROOT,
    packagesRoot: process.env.REGISTRY_BACKUP_PACKAGES_ROOT ?? DEFAULT_PACKAGES_ROOT,
  };
}

export function getRegistryArtifactBackupContext(): RegistryArtifactBackupContext {
  return getRegistryArtifactBackupSettings();
}

export async function backupSkillVersionToObjectStorage(
  ctx: Pick<ActionCtx, "storage">,
  params: SkillBackupParams & { root?: string },
  context: RegistryArtifactBackupContext = getRegistryArtifactBackupContext(),
) {
  const planned = buildSkillVersionBackupManifest({
    root: params.root ?? context.skillsRoot,
    ...params,
  });

  for (const file of planned.fileObjects) {
    const blob = await readStorageBlob(ctx, file.storageId);
    await putObject(context, file.key, new Uint8Array(await blob.arrayBuffer()), {
      contentType: file.contentType,
    });
  }

  await putJsonObject(context, planned.metaPath, planned.meta);
  await putMergedJsonIndex(context, planned.indexPath, (existingIndex: SkillIndexFile | null) =>
    buildSkillIndexFile(planned, existingIndex),
  );
}

export async function backupPackageReleaseToObjectStorage(
  ctx: Pick<ActionCtx, "storage">,
  params: PackageBackupParams & { artifactStorageId: Id<"_storage">; root?: string },
  context: RegistryArtifactBackupContext = getRegistryArtifactBackupContext(),
) {
  const planned = buildPackageReleaseBackupManifest({
    root: params.root ?? context.packagesRoot,
    ...params,
  });
  const artifact = await readStorageBlob(ctx, params.artifactStorageId);
  await putObject(context, planned.artifactPath, new Uint8Array(await artifact.arrayBuffer()), {
    contentType: packageArtifactContentType(params.artifactFormat),
  });

  await putJsonObject(context, planned.metaPath, planned.meta);
  await putMergedJsonIndex(context, planned.indexPath, (existingIndex: PackageIndexFile | null) =>
    buildPackageIndexFile(planned, existingIndex),
  );
}

export async function repairSkillVersionBackupIndex(
  _ctx: Pick<ActionCtx, "storage">,
  params: SkillBackupParams & { root?: string },
  context: RegistryArtifactBackupContext = getRegistryArtifactBackupContext(),
) {
  await repairSkillVersionBackupIndexes(_ctx, [params], context);
}

export async function repairSkillVersionBackupIndexes(
  _ctx: Pick<ActionCtx, "storage">,
  params: Array<SkillBackupParams & { root?: string }>,
  context: RegistryArtifactBackupContext = getRegistryArtifactBackupContext(),
) {
  if (params.length === 0) return;
  const planned = params.map((item) =>
    buildSkillVersionBackupManifest({
      root: item.root ?? context.skillsRoot,
      ...item,
    }),
  );
  const [first, ...rest] = planned;
  if (!first) return;
  const indexPath = sharedIndexPath(planned.map((item) => item.indexPath));
  await putMergedJsonIndex(context, indexPath, (existingIndex: SkillIndexFile | null) =>
    rest.reduce(
      (nextIndex, plannedItem) => buildSkillIndexFile(plannedItem, nextIndex),
      buildSkillIndexFile(first, existingIndex),
    ),
  );
}

export async function repairPackageReleaseBackupIndex(
  _ctx: Pick<ActionCtx, "storage">,
  params: PackageBackupParams & { root?: string },
  context: RegistryArtifactBackupContext = getRegistryArtifactBackupContext(),
) {
  await repairPackageReleaseBackupIndexes(_ctx, [params], context);
}

export async function repairPackageReleaseBackupIndexes(
  _ctx: Pick<ActionCtx, "storage">,
  params: Array<PackageBackupParams & { root?: string }>,
  context: RegistryArtifactBackupContext = getRegistryArtifactBackupContext(),
) {
  if (params.length === 0) return;
  const planned = params.map((item) =>
    buildPackageReleaseBackupManifest({
      root: item.root ?? context.packagesRoot,
      ...item,
    }),
  );
  const [first, ...rest] = planned;
  if (!first) return;
  const indexPath = sharedIndexPath(planned.map((item) => item.indexPath));
  await putMergedJsonIndex(context, indexPath, (existingIndex: PackageIndexFile | null) =>
    rest.reduce(
      (nextIndex, plannedItem) => buildPackageIndexFile(plannedItem, nextIndex),
      buildPackageIndexFile(first, existingIndex),
    ),
  );
}

export async function fetchSkillVersionBackupMeta(
  context: RegistryArtifactBackupContext,
  ownerHandle: string,
  slug: string,
  version: string,
) {
  const owner = normalizeOwner(ownerHandle);
  const path = `${context.skillsRoot}/${owner}/${slug}/${encodeBackupPathSegment(
    version,
  )}/${META_FILENAME}`;
  return getJsonObject<ReturnType<typeof buildSkillVersionBackupManifest>["meta"]>(context, path);
}

export async function fetchSkillBackupIndex(
  context: RegistryArtifactBackupContext,
  ownerHandle: string,
  slug: string,
) {
  const owner = normalizeOwner(ownerHandle);
  const path = `${context.skillsRoot}/${owner}/${slug}/${INDEX_FILENAME}`;
  return getJsonObject<SkillIndexFile>(context, path);
}

export async function fetchPackageReleaseBackupMeta(
  context: RegistryArtifactBackupContext,
  ownerHandle: string,
  normalizedName: string,
  version: string,
) {
  const owner = normalizeOwner(ownerHandle);
  const path = `${context.packagesRoot}/${owner}/${encodeBackupPathSegment(
    normalizedName,
  )}/${encodeBackupPathSegment(version)}/${META_FILENAME}`;
  return getJsonObject<ReturnType<typeof buildPackageReleaseBackupManifest>["meta"]>(context, path);
}

export async function readRegistryArtifactBackupObject(
  context: RegistryArtifactBackupContext,
  key: string,
) {
  const response = await signedFetch(context, "GET", key);
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Registry artifact backup GET ${key} failed: ${body}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function buildSkillVersionBackupManifest(params: SkillBackupParams & { root: string }) {
  const owner = normalizeOwner(params.ownerHandle);
  const versionSegment = encodeBackupPathSegment(params.version);
  const skillRoot = `${params.root}/${owner}/${params.slug}`;
  const versionRoot = `${skillRoot}/${versionSegment}`;
  const metaPath = `${versionRoot}/${META_FILENAME}`;
  const indexPath = `${skillRoot}/${INDEX_FILENAME}`;
  const files = params.files.map((file) => {
    if (!validateFilePath(file.path)) {
      throw new Error(`Invalid skill backup file path: ${file.path}`);
    }
    return file;
  });
  const fileObjects = files.map((file) => ({
    ...file,
    key: `${versionRoot}/${file.path}`,
  }));
  const meta = {
    kind: "skillVersion" as const,
    owner,
    slug: params.slug,
    displayName: params.displayName,
    version: params.version,
    isLatest: params.isLatest,
    publishedAt: params.publishedAt,
    restore: {
      skillId: params.skillId,
      versionId: params.versionId,
    },
    metadata: {
      files: files.map(({ path, size, sha256, contentType }) => ({
        path,
        size,
        sha256,
        contentType,
      })),
    },
  };

  return {
    skillRoot,
    versionRoot,
    metaPath,
    indexPath,
    fileObjects,
    meta,
  };
}

export function buildPackageReleaseBackupManifest(params: PackageBackupParams & { root: string }) {
  const owner = normalizeOwner(params.ownerHandle);
  const packageSegment = encodeBackupPathSegment(params.normalizedName || params.packageName);
  const artifactFileName = validatePackageArtifactFileName(
    params.artifactFileName ?? defaultPackageArtifactFileName(params),
  );
  const packageRoot = `${params.root}/${owner}/${packageSegment}`;
  const releaseRoot = `${packageRoot}/${encodeBackupPathSegment(params.version)}`;
  const meta = {
    kind: "packageRelease" as const,
    owner,
    packageName: params.packageName,
    normalizedName: params.normalizedName,
    displayName: params.displayName,
    family: params.family,
    version: params.version,
    isLatest: params.isLatest,
    publishedAt: params.publishedAt,
    runtimeId: params.runtimeId,
    sourceRepo: params.sourceRepo,
    artifactKind: params.artifactKind,
    artifact: {
      path: artifactFileName,
      sha256: params.artifactSha256,
      size: params.artifactSize,
      format: params.artifactFormat,
      npmIntegrity: params.npmIntegrity,
      npmShasum: params.npmShasum,
      npmUnpackedSize: params.npmUnpackedSize,
      npmFileCount: params.npmFileCount,
    },
    restore: {
      packageId: params.packageId,
      releaseId: params.releaseId,
    },
    metadata: {
      compatibility: params.compatibility,
      capabilities: params.capabilities,
      extractedPackageJson: params.extractedPackageJson,
      extractedPluginManifest: params.extractedPluginManifest,
      normalizedBundleManifest: params.normalizedBundleManifest,
      files: params.files,
    },
  };

  return {
    packageRoot,
    releaseRoot,
    artifactPath: `${releaseRoot}/${artifactFileName}`,
    metaPath: `${releaseRoot}/${META_FILENAME}`,
    indexPath: `${packageRoot}/${INDEX_FILENAME}`,
    meta,
  };
}

function buildSkillIndexFile(
  planned: ReturnType<typeof buildSkillVersionBackupManifest>,
  existing: SkillIndexFile | null,
): SkillIndexFile {
  const nextVersion: SkillIndexEntry = {
    version: planned.meta.version,
    isLatest: planned.meta.isLatest,
    publishedAt: planned.meta.publishedAt,
    skillId: planned.meta.restore.skillId,
    versionId: planned.meta.restore.versionId,
    path: planned.metaPath,
  };
  const byVersion = new Map<string, SkillIndexEntry>();
  for (const entry of [nextVersion, existing?.latest, ...(existing?.versions ?? [])]) {
    if (entry && !byVersion.has(entry.version)) byVersion.set(entry.version, entry);
  }
  const mergedVersions = Array.from(byVersion.values());
  const explicitLatest = nextVersion.isLatest
    ? nextVersion
    : mergedVersions.find((entry) => entry.isLatest);
  const versions = mergedVersions
    .map((entry) => ({
      ...entry,
      isLatest: explicitLatest ? entry.version === explicitLatest.version : entry.isLatest,
    }))
    .sort(compareSkillIndexEntriesForLatest);
  const latest = explicitLatest
    ? (versions.find((entry) => entry.version === explicitLatest.version) ?? explicitLatest)
    : (versions[0] ?? nextVersion);

  return {
    kind: "skill",
    owner: planned.meta.owner,
    slug: planned.meta.slug,
    displayName: planned.meta.displayName,
    latest,
    versions,
  };
}

function sharedIndexPath(paths: string[]) {
  const [first, ...rest] = paths;
  if (!first || rest.some((path) => path !== first)) {
    throw new Error("Registry artifact backup bulk index repair received mixed roots");
  }
  return first;
}

function compareSkillIndexEntriesForLatest(left: SkillIndexEntry, right: SkillIndexEntry) {
  const leftValid = semver.valid(left.version);
  const rightValid = semver.valid(right.version);
  if (leftValid && rightValid) return semver.rcompare(leftValid, rightValid);
  if (leftValid) return -1;
  if (rightValid) return 1;
  return right.publishedAt - left.publishedAt;
}

function buildPackageIndexFile(
  planned: ReturnType<typeof buildPackageReleaseBackupManifest>,
  existing: PackageIndexFile | null,
): PackageIndexFile {
  const nextVersion: PackageIndexEntry = {
    version: planned.meta.version,
    isLatest: planned.meta.isLatest,
    publishedAt: planned.meta.publishedAt,
    packageId: planned.meta.restore.packageId,
    releaseId: planned.meta.restore.releaseId,
    path: planned.metaPath,
  };
  const byRelease = new Map<string, PackageIndexEntry>();
  for (const entry of [nextVersion, existing?.latest, ...(existing?.versions ?? [])]) {
    if (entry && !byRelease.has(entry.releaseId)) byRelease.set(entry.releaseId, entry);
  }
  const mergedVersions = Array.from(byRelease.values());
  const explicitLatest = nextVersion.isLatest
    ? nextVersion
    : mergedVersions.find((entry) => entry.isLatest);
  const versions = mergedVersions
    .map((entry) => ({
      ...entry,
      isLatest: explicitLatest ? entry.releaseId === explicitLatest.releaseId : entry.isLatest,
    }))
    .sort((a, b) => b.publishedAt - a.publishedAt);
  const latest = explicitLatest
    ? (versions.find((entry) => entry.releaseId === explicitLatest.releaseId) ?? explicitLatest)
    : (versions[0] ?? nextVersion);

  return {
    kind: "package",
    owner: planned.meta.owner,
    packageName: planned.meta.packageName,
    normalizedName: planned.meta.normalizedName,
    displayName: planned.meta.displayName,
    family: planned.meta.family,
    latest,
    versions,
  };
}

export const __registryArtifactBackupTestInternals = {
  buildPackageIndexFile,
  buildSkillIndexFile,
  encodeBackupPathSegment,
};

export function normalizeOwner(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return normalized || "unknown";
}

function encodeBackupPathSegment(value: string) {
  return encodeURIComponent(value.trim()).replace(/\./g, "%2E");
}

function normalizePackagePathSegment(value: string) {
  return normalizeOwner(value.replace(/^@/, "").replace("/", "-"));
}

function defaultPackageArtifactFileName(
  params: Pick<PackageBackupParams, "normalizedName" | "version">,
) {
  return `${normalizePackagePathSegment(params.normalizedName)}-${encodeBackupPathSegment(
    params.version,
  )}.tgz`;
}

function validatePackageArtifactFileName(value: string) {
  const artifactFileName = value.trim();
  if (
    !artifactFileName ||
    artifactFileName === "." ||
    artifactFileName === ".." ||
    artifactFileName.includes("/") ||
    artifactFileName.includes("\\") ||
    artifactFileName.includes("\0")
  ) {
    throw new Error("Invalid package backup artifact filename");
  }
  return artifactFileName;
}

async function readStorageBlob(ctx: Pick<ActionCtx, "storage">, storageId: Id<"_storage">) {
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new Error("File missing in storage");
  return blob;
}

async function putJsonObject(context: RegistryArtifactBackupContext, key: string, value: unknown) {
  await putObject(context, key, `${JSON.stringify(value, null, 2)}\n`, {
    contentType: "application/json; charset=utf-8",
  });
}

async function getJsonObject<T>(context: RegistryArtifactBackupContext, key: string) {
  const result = await getJsonObjectForUpdate(context, key);
  return result.value as T | null;
}

async function getJsonObjectForUpdate(context: RegistryArtifactBackupContext, key: string) {
  const response = await signedFetch(context, "GET", key);
  if (response.status === 404) return { value: null, etag: null };
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Registry artifact backup GET ${key} failed: ${body}`);
  }
  return {
    value: (await response.json()) as unknown,
    etag: response.headers.get("etag"),
  };
}

async function putMergedJsonIndex<T>(
  context: RegistryArtifactBackupContext,
  key: string,
  buildNext: (existing: T | null) => T,
) {
  for (let attempt = 1; attempt <= MAX_INDEX_WRITE_ATTEMPTS; attempt++) {
    const existing = await getJsonObjectForUpdate(context, key);
    const existingValue = existing.value as T | null;
    if (existingValue && !existing.etag) {
      throw new Error(`Registry artifact backup GET ${key} missing ETag`);
    }

    const result = await putObject(
      context,
      key,
      `${JSON.stringify(buildNext(existingValue), null, 2)}\n`,
      {
        contentType: "application/json; charset=utf-8",
        ifMatch: existing.etag ?? undefined,
        ifNoneMatch: existingValue ? undefined : "*",
        allowPreconditionFailed: true,
      },
    );
    if (result === "ok") return;
    await sleep(indexWriteRetryDelayMs(attempt));
  }

  throw new Error(`Registry artifact backup index ${key} changed too frequently`);
}

function indexWriteRetryDelayMs(attempt: number) {
  const base = Math.min(
    MAX_INDEX_WRITE_RETRY_DELAY_MS,
    MIN_INDEX_WRITE_RETRY_DELAY_MS * 2 ** attempt,
  );
  return base + Math.floor(Math.random() * MIN_INDEX_WRITE_RETRY_DELAY_MS);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putObject(
  context: RegistryArtifactBackupContext,
  key: string,
  body: string | Uint8Array,
  options: {
    contentType?: string;
    ifMatch?: string;
    ifNoneMatch?: string;
    allowPreconditionFailed?: boolean;
  } = {},
) {
  const response = await signedFetch(context, "PUT", key, body, options);
  if (options.allowPreconditionFailed && response.status === 412) {
    return "preconditionFailed" as const;
  }
  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Registry artifact backup PUT ${key} failed: ${responseBody}`);
  }
  return "ok" as const;
}

async function signedFetch(
  context: RegistryArtifactBackupContext,
  method: "GET" | "PUT",
  key: string,
  body?: string | Uint8Array,
  options: { contentType?: string; ifMatch?: string; ifNoneMatch?: string } = {},
) {
  const now = new Date();
  const bodyBytes = body === undefined ? new Uint8Array() : toBytes(body);
  const payloadHash = sha256Hex(bodyBytes);
  const url = objectUrl(context, key);
  const headers = new Headers();
  headers.set("host", url.host);
  headers.set("x-amz-content-sha256", payloadHash);
  headers.set("x-amz-date", amzDate(now));
  if (options.contentType) headers.set("content-type", options.contentType);
  if (options.ifMatch) headers.set("if-match", options.ifMatch);
  if (options.ifNoneMatch) headers.set("if-none-match", options.ifNoneMatch);
  headers.set(
    "authorization",
    authorizationHeader(context, method, url, headers, payloadHash, now),
  );

  const init: RequestInit = { method, headers };
  if (method === "PUT") {
    init.body = toArrayBuffer(bodyBytes);
  }
  return fetch(url, init);
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function authorizationHeader(
  context: RegistryArtifactBackupContext,
  method: string,
  url: URL,
  headers: Headers,
  payloadHash: string,
  now: Date,
) {
  const date = amzDate(now).slice(0, 8);
  const credentialScope = `${date}/${context.region}/s3/aws4_request`;
  const signedHeaders = Array.from(headers.keys())
    .map((name) => name.toLowerCase())
    .sort()
    .join(";");
  const canonicalHeaders = signedHeaders
    .split(";")
    .map((name) => `${name}:${headers.get(name)?.trim() ?? ""}\n`)
    .join("");
  const canonicalRequest = [
    method,
    url.pathname,
    url.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate(now),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${context.secretAccessKey}`, date), context.region), "s3"),
    "aws4_request",
  );
  const signature = hmacHex(signingKey, stringToSign);
  return `AWS4-HMAC-SHA256 Credential=${context.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function objectUrl(context: RegistryArtifactBackupContext, key: string) {
  const endpoint = context.endpoint.replace(/\/+$/, "");
  return new URL(`${endpoint}/${encodePathSegment(context.bucket)}/${encodeObjectKey(key)}`);
}

function encodeObjectKey(key: string) {
  return key.split("/").map(encodePathSegment).join("/");
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value);
}

function amzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function toBytes(value: string | Uint8Array) {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function packageArtifactContentType(format: PackageBackupParams["artifactFormat"]) {
  return format === "tgz" ? "application/gzip" : "application/octet-stream";
}

function r2EndpointFromAccountId(accountId: string | undefined) {
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
