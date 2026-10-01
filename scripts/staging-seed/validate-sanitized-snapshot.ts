#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { listSnapshotEntries, readSelectedSnapshotEntries, readSnapshotTable } from "./snapshotIo";
import { sanitizePublicText, type SnapshotDocument, type SnapshotFile } from "./snapshotPolicy";

const REQUIRED_TABLES = [
  "users",
  "publishers",
  "skills",
  "skillVersions",
  "packages",
  "packageReleases",
] as const;

const ALLOWED_TABLES = new Set([
  ...REQUIRED_TABLES,
  "skillSearchDigest",
  "skillTopicSearchDigest",
  "curatedSkillSearchDigest",
  "skillDailyStats",
  "skillLeaderboards",
  "packageSearchDigest",
  "packageTopicSearchDigest",
  "packagePluginCategorySearchDigest",
  "packageDailyStats",
  "packageLeaderboards",
  "_storage",
  "_tables",
]);

const PRIVATE_KEY_PATTERN =
  /(?:email|phone|token|secret|password|authorization|githubId|oauth|ipAddress)/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const UNIX_LOCAL_PATH_PATTERN = /(?:\/Users\/|\/var\/folders\/|\/private\/tmp\/)/;
const WINDOWS_LOCAL_PATH_PATTERN = /C:\\Users\\/i;
const REDACTED_PATH_SUFFIX_PATTERN = /\[REDACTED_PATH\][\\/]/;

export async function validateSanitizedSnapshot(snapshotPath: string) {
  const entries = await validateEntries(snapshotPath);
  const storageEntries = storageEntriesFromEntries(entries);
  const storageIds = new Set(storageEntries.keys());
  const userIds = await validateDummyIdentities(snapshotPath, "users", "user");
  await validateDummyIdentities(snapshotPath, "publishers", "publisher");
  const selectedStorageIds = new Set<string>();
  const artifactFiles = new Map<string, SnapshotFile>();
  const storageDocuments = new Map<string, SnapshotDocument>();
  for await (const storage of readSnapshotTable(snapshotPath, "_storage")) {
    validateDocument(storage, "_storage");
    if (
      typeof storage.sha256 !== "string" ||
      Buffer.from(storage.sha256, "base64").byteLength !== 32
    ) {
      throw new Error(`_storage/${storage._id} has an invalid SHA-256 value`);
    }
    storageDocuments.set(storage._id, storage);
  }

  let skillCount = 0;
  for await (const skill of readSnapshotTable(snapshotPath, "skills")) {
    validateDocument(skill, "skills");
    if ("badges" in skill) throw new Error(`skills/${skill._id} contains badges`);
    skillCount += 1;
  }

  for await (const version of readSnapshotTable(snapshotPath, "skillVersions")) {
    validateDocument(version, "skillVersions");
    validateCreatedBy(version, userIds, "skillVersions");
    const files = snapshotFiles(version.files);
    if (files.length !== 1 || files[0]?.path.toLowerCase() !== "skill.md") {
      throw new Error(`skillVersions/${version._id} must contain only SKILL.md`);
    }
    collectStorageIds(files, selectedStorageIds, artifactFiles);
  }

  let packageCount = 0;
  for await (const pkg of readSnapshotTable(snapshotPath, "packages")) {
    validateDocument(pkg, "packages");
    packageCount += 1;
  }

  for await (const release of readSnapshotTable(snapshotPath, "packageReleases")) {
    validateDocument(release, "packageReleases");
    validateCreatedBy(release, userIds, "packageReleases");
    const files = snapshotFiles(release.files);
    if (files.some((file) => !isAllowedPackagePath(file.path))) {
      throw new Error(`packageReleases/${release._id} contains a non-allowlisted file`);
    }
    collectStorageIds(files, selectedStorageIds, artifactFiles);
  }

  for (const table of ALLOWED_TABLES) {
    if (
      table === "_storage" ||
      table === "_tables" ||
      REQUIRED_TABLES.includes(table as (typeof REQUIRED_TABLES)[number])
    ) {
      continue;
    }
    if (!entries.has(`${table}/documents.jsonl`)) continue;
    for await (const row of readSnapshotTable(snapshotPath, table)) {
      validateDocument(row, table);
      validateDerivedOwner(row, table);
      if ("badges" in row) throw new Error(`${table}/${row._id} contains badges`);
    }
  }

  const missingStorage = [...selectedStorageIds].filter((id) => !storageIds.has(id));
  if (missingStorage.length > 0) {
    throw new Error(`Snapshot is missing ${missingStorage.length} referenced storage files`);
  }
  const unreferencedStorage = [...storageIds].filter((id) => !selectedStorageIds.has(id));
  if (unreferencedStorage.length > 0) {
    throw new Error(`Snapshot contains ${unreferencedStorage.length} unreferenced storage files`);
  }
  const missingStorageDocuments = [...storageIds].filter((id) => !storageDocuments.has(id));
  if (missingStorageDocuments.length > 0) {
    throw new Error(`Snapshot is missing ${missingStorageDocuments.length} storage metadata rows`);
  }
  const storageDocumentsWithoutFiles = [...storageDocuments.keys()].filter(
    (id) => !storageIds.has(id),
  );
  if (storageDocumentsWithoutFiles.length > 0) {
    throw new Error(
      `Snapshot contains ${storageDocumentsWithoutFiles.length} storage metadata rows without files`,
    );
  }
  await validateStorageContents(snapshotPath, storageEntries, storageDocuments, artifactFiles);

  return {
    skills: skillCount,
    packages: packageCount,
    storageFiles: selectedStorageIds.size,
  };
}

async function validateEntries(snapshotPath: string) {
  const entries = new Set<string>();
  for await (const entry of listSnapshotEntries(snapshotPath)) {
    entries.add(entry);
    if (entry.endsWith("/")) continue;
    const [table, filename, extra] = entry.split("/");
    if (!table || !filename || extra) throw new Error(`Unexpected snapshot entry: ${entry}`);
    if (!ALLOWED_TABLES.has(table)) throw new Error(`Disallowed snapshot table: ${table}`);
    if (table === "_storage") {
      if (filename === "documents.jsonl") continue;
      if (!/^kg[0-9a-z]+(?:\.[a-z0-9]+)?$/i.test(filename)) {
        throw new Error(`Unexpected storage entry: ${entry}`);
      }
      continue;
    }
    if (table === "_tables") {
      if (filename !== "documents.jsonl") throw new Error(`Unexpected metadata entry: ${entry}`);
      continue;
    }
    if (filename !== "documents.jsonl" && filename !== "generated_schema.jsonl") {
      throw new Error(`Unexpected table entry: ${entry}`);
    }
  }
  for (const table of REQUIRED_TABLES) {
    if (!entries.has(`${table}/documents.jsonl`))
      throw new Error(`Missing required table: ${table}`);
  }
  if (!entries.has("_storage/documents.jsonl")) throw new Error("Missing _storage metadata");
  if (!entries.has("_tables/documents.jsonl")) throw new Error("Missing _tables metadata");
  return entries;
}

async function validateDummyIdentities(
  snapshotPath: string,
  table: "users" | "publishers",
  kind: "user" | "publisher",
) {
  const ids = new Set<string>();
  for await (const row of readSnapshotTable(snapshotPath, table)) {
    validateDocument(row, table);
    ids.add(row._id);
    if (
      typeof row.handle !== "string" ||
      !row.handle.startsWith(`test-snapshot-${kind}-`) ||
      typeof row.displayName !== "string" ||
      !row.displayName.startsWith(`Test Snapshot ${kind === "user" ? "User" : "Publisher"} `)
    ) {
      throw new Error(`${table}/${row._id} is not a deterministic dummy identity`);
    }
    if (typeof row.image !== "string" || !row.image.includes("api.dicebear.com")) {
      throw new Error(`${table}/${row._id} does not use a synthetic image`);
    }
  }
  return ids;
}

function validateDocument(value: unknown, location: string) {
  walk(value, location);
}

function walk(value: unknown, location: string) {
  if (typeof value === "string") {
    if (EMAIL_PATTERN.test(value)) throw new Error(`${location} contains an email address`);
    if (containsLocalPath(value)) throw new Error(`${location} contains a local path`);
    if (REDACTED_PATH_SUFFIX_PATTERN.test(value)) {
      throw new Error(`${location} contains a partially redacted local path`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEY_PATTERN.test(key)) throw new Error(`${location} contains private key ${key}`);
    walk(child, `${location}.${key}`);
  }
}

export function containsLocalPath(value: string) {
  return UNIX_LOCAL_PATH_PATTERN.test(value) || WINDOWS_LOCAL_PATH_PATTERN.test(value);
}

function validateCreatedBy(row: SnapshotDocument, userIds: ReadonlySet<string>, table: string) {
  if (typeof row.createdBy !== "string" || !userIds.has(row.createdBy)) {
    throw new Error(`${table}/${row._id} is not assigned to a dummy user`);
  }
}

function validateDerivedOwner(row: SnapshotDocument, table: string) {
  if ("ownerHandle" in row) {
    if (typeof row.ownerHandle !== "string" || !row.ownerHandle.startsWith("test-snapshot-")) {
      throw new Error(`${table}/${row._id} contains a real owner handle`);
    }
  }
  if ("ownerImage" in row) {
    if (typeof row.ownerImage !== "string" || !row.ownerImage.includes("api.dicebear.com")) {
      throw new Error(`${table}/${row._id} contains a real owner image`);
    }
  }
}

function snapshotFiles(value: unknown): SnapshotFile[] {
  if (!Array.isArray(value)) return [];
  for (const file of value as SnapshotFile[]) {
    if (
      typeof file.path !== "string" ||
      typeof file.storageId !== "string" ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/i.test(file.sha256)
    ) {
      throw new Error("Artifact contains invalid file metadata");
    }
  }
  return value as SnapshotFile[];
}

function collectStorageIds(
  files: SnapshotFile[],
  output: Set<string>,
  artifactFiles: Map<string, SnapshotFile>,
) {
  for (const file of files) {
    output.add(file.storageId);
    const existing = artifactFiles.get(file.storageId);
    if (
      existing &&
      (existing.sha256 !== file.sha256 ||
        existing.size !== file.size ||
        existing.path !== file.path)
    ) {
      throw new Error(`Storage ${file.storageId} has conflicting artifact metadata`);
    }
    artifactFiles.set(file.storageId, file);
  }
}

function storageEntriesFromEntries(entries: ReadonlySet<string>) {
  const storageEntries = new Map<string, string>();
  for (const entry of entries) {
    if (
      !entry.startsWith("_storage/") ||
      entry.endsWith("/") ||
      entry === "_storage/documents.jsonl"
    ) {
      continue;
    }
    const filename = entry.slice("_storage/".length);
    const storageId = filename.includes(".") ? filename.slice(0, filename.indexOf(".")) : filename;
    storageEntries.set(storageId, entry);
  }
  return storageEntries;
}

async function validateStorageContents(
  snapshotPath: string,
  storageEntries: ReadonlyMap<string, string>,
  storageDocuments: ReadonlyMap<string, SnapshotDocument>,
  artifactFiles: ReadonlyMap<string, SnapshotFile>,
) {
  const storageIdsByEntry = new Map(
    [...storageEntries].map(([storageId, entry]) => [entry, storageId]),
  );
  for await (const { entry, bytes } of readSelectedSnapshotEntries(
    snapshotPath,
    new Set(storageEntries.values()),
  )) {
    const storageId = storageIdsByEntry.get(entry);
    if (!storageId) throw new Error(`Unexpected storage entry: ${entry}`);
    const text = bytes.toString("utf8");
    validateDocument(text, entry);
    if (sanitizePublicText(text) !== text) {
      throw new Error(`${entry} contains content that was not sanitized`);
    }
    const digest = createHash("sha256").update(bytes).digest();
    const storageDocument = storageDocuments.get(storageId);
    const artifactFile = artifactFiles.get(storageId);
    if (!storageDocument || !artifactFile) {
      throw new Error(`${entry} is missing linked metadata`);
    }
    if (storageDocument.size !== bytes.byteLength) {
      throw new Error(`${entry} size does not match _storage metadata`);
    }
    if (storageDocument.sha256 !== digest.toString("base64")) {
      throw new Error(`${entry} SHA-256 does not match _storage metadata`);
    }
    if (artifactFile.size !== bytes.byteLength) {
      throw new Error(`${entry} size does not match artifact metadata`);
    }
    if (artifactFile.sha256 !== digest.toString("hex")) {
      throw new Error(`${entry} SHA-256 does not match artifact metadata`);
    }
  }
}

function isAllowedPackagePath(path: string) {
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

async function main() {
  const snapshotPath = resolve(process.argv[2] ?? "");
  if (!process.argv[2]) throw new Error("Usage: validate-sanitized-snapshot.ts <snapshot.zip>");
  const result = await validateSanitizedSnapshot(snapshotPath);
  console.log(JSON.stringify({ ok: true, snapshot: snapshotPath, ...result }, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
