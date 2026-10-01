#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  listSelectedStorageEntries,
  readSelectedSnapshotEntries,
  readSnapshotTable,
  runCommand,
} from "./snapshotIo";
import {
  isPublicPackageSnapshot,
  isPublicSkillSnapshot,
  publicPackageFields,
  publicPackageReleaseFields,
  publicSkillFields,
  publicSkillVersionFields,
  sanitizeDerivedSnapshot,
  sanitizePublisherSnapshot,
  sanitizePublicText,
  sanitizeUserSnapshot,
  selectPackageSnapshotFiles,
  selectSkillSnapshotFiles,
  type SnapshotDocument,
  type SnapshotFile,
} from "./snapshotPolicy";

type Options = {
  input: string;
  output: string;
  keepWorkDir: boolean;
  limit: number | null;
};

type SelectedArtifact = {
  doc: SnapshotDocument;
  files: SnapshotFile[];
  ownerUserId: string;
};

const DERIVED_SKILL_TABLES = [
  "skillSearchDigest",
  "skillTopicSearchDigest",
  "curatedSkillSearchDigest",
  "skillDailyStats",
  "skillLeaderboards",
] as const;
const DERIVED_PACKAGE_TABLES = [
  "packageSearchDigest",
  "packageTopicSearchDigest",
  "packagePluginCategorySearchDigest",
  "packageDailyStats",
  "packageLeaderboards",
] as const;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = resolve(options.input);
  const output = resolve(options.output);
  if ((await stat(input)).size === 0) throw new Error(`Snapshot is empty: ${input}`);

  const workDir = await mkdtemp(join(tmpdir(), "clawhub-staging-snapshot-"));
  const bundleDir = join(workDir, "bundle");
  await mkdir(bundleDir, { recursive: true });

  try {
    const selectedSkills = await selectSkills(input, options.limit);
    const selectedPackages = await selectPackages(input, options.limit);
    const skillVersions = await selectSkillVersions(input, selectedSkills);
    const packageReleases = await selectPackageReleases(input, selectedPackages);

    removeMissingParents(selectedSkills, skillVersions, "latestVersionId");
    removeMissingParents(selectedPackages, packageReleases, "latestReleaseId");

    const storageIds = collectStorageIds(skillVersions, packageReleases);
    const storageEntries = await listSelectedStorageEntries(input, storageIds);
    assertAllStorageFound(storageIds, storageEntries);
    const storageDocs = await selectStorageDocs(input, storageIds);
    await sanitizeStorageFiles(input, bundleDir, storageEntries, storageDocs);
    updateArtifactFileMetadata(skillVersions, storageDocs);
    updateArtifactFileMetadata(packageReleases, storageDocs);

    const userIds = collectUserIds(selectedSkills, selectedPackages);
    const publisherIds = collectPublisherIds(selectedSkills, selectedPackages);
    const users = await selectUsers(input, userIds, publisherIds);
    const publishers = await selectPublishers(input, publisherIds, userIds);

    await writeTable(
      bundleDir,
      "users",
      [...users.values()].map((doc) => sanitizeUserSnapshot(doc, publisherIds)),
      input,
    );
    await writeTable(
      bundleDir,
      "publishers",
      [...publishers.values()].map((doc) => sanitizePublisherSnapshot(doc, userIds)),
      input,
    );
    await writeTable(
      bundleDir,
      "skills",
      [...selectedSkills.values()].map(publicSkillFields),
      input,
    );
    await writeTable(
      bundleDir,
      "skillVersions",
      [...skillVersions.values()].map(({ doc, files, ownerUserId }) =>
        publicSkillVersionFields(doc, ownerUserId, files),
      ),
      input,
    );
    await writeTable(
      bundleDir,
      "packages",
      [...selectedPackages.values()].map(publicPackageFields),
      input,
    );
    await writeTable(
      bundleDir,
      "packageReleases",
      [...packageReleases.values()].map(({ doc, files, ownerUserId }) =>
        publicPackageReleaseFields(doc, ownerUserId, files),
      ),
      input,
    );

    for (const table of DERIVED_SKILL_TABLES) {
      await copyDerivedTable(input, bundleDir, table, selectedSkills, "skillId");
    }
    for (const table of DERIVED_PACKAGE_TABLES) {
      await copyDerivedTable(input, bundleDir, table, selectedPackages, "packageId");
    }
    await writeStorageDocuments(bundleDir, storageDocs);
    await writeTablesMetadata(bundleDir, input);
    await rm(output, { force: true });
    await runCommand("zip", ["-q", "-r", output, "."], bundleDir);
    await writeManifest(
      `${output}.manifest.json`,
      input,
      selectedSkills.size,
      selectedPackages.size,
      storageIds.size,
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          input,
          output,
          skills: selectedSkills.size,
          packages: selectedPackages.size,
          storageFiles: storageIds.size,
        },
        null,
        2,
      ),
    );
  } finally {
    if (options.keepWorkDir) console.log(`Kept work directory: ${workDir}`);
    else await rm(workDir, { recursive: true, force: true });
  }
}

async function selectSkills(input: string, limit: number | null) {
  const rows = new Map<string, SnapshotDocument>();
  for await (const doc of readSnapshotTable(input, "skills")) {
    if (!isPublicSkillSnapshot(doc) || typeof doc.latestVersionId !== "string") continue;
    rows.set(doc._id, doc);
    if (limit && rows.size >= limit) break;
  }
  return rows;
}

async function selectPackages(input: string, limit: number | null) {
  const rows = new Map<string, SnapshotDocument>();
  for await (const doc of readSnapshotTable(input, "packages")) {
    if (!isPublicPackageSnapshot(doc) || typeof doc.latestReleaseId !== "string") continue;
    rows.set(doc._id, doc);
    if (limit && rows.size >= limit) break;
  }
  return rows;
}

async function selectSkillVersions(input: string, skills: ReadonlyMap<string, SnapshotDocument>) {
  const wanted = new Map(
    [...skills.values()].map((skill) => [skill.latestVersionId as string, skill]),
  );
  const rows = new Map<string, SelectedArtifact>();
  for await (const doc of readSnapshotTable(input, "skillVersions")) {
    const skill = wanted.get(doc._id);
    if (!skill) continue;
    const files = selectSkillSnapshotFiles(doc.files);
    if (files.length === 0 || typeof skill.ownerUserId !== "string") continue;
    rows.set(doc._id, { doc, files, ownerUserId: skill.ownerUserId });
  }
  return rows;
}

async function selectPackageReleases(
  input: string,
  packages: ReadonlyMap<string, SnapshotDocument>,
) {
  const wanted = new Map([...packages.values()].map((pkg) => [pkg.latestReleaseId as string, pkg]));
  const rows = new Map<string, SelectedArtifact>();
  for await (const doc of readSnapshotTable(input, "packageReleases")) {
    const pkg = wanted.get(doc._id);
    if (!pkg) continue;
    const files = selectPackageSnapshotFiles(doc.files);
    if (files.length === 0 || typeof pkg.ownerUserId !== "string") continue;
    rows.set(doc._id, { doc, files, ownerUserId: pkg.ownerUserId });
  }
  return rows;
}

function removeMissingParents(
  parents: Map<string, SnapshotDocument>,
  children: ReadonlyMap<string, SelectedArtifact>,
  field: "latestVersionId" | "latestReleaseId",
) {
  for (const [id, parent] of parents) {
    if (typeof parent[field] !== "string" || !children.has(parent[field])) parents.delete(id);
  }
}

function collectStorageIds(
  skillVersions: ReadonlyMap<string, SelectedArtifact>,
  packageReleases: ReadonlyMap<string, SelectedArtifact>,
) {
  const ids = new Set<string>();
  for (const artifact of [...skillVersions.values(), ...packageReleases.values()]) {
    for (const file of artifact.files) ids.add(file.storageId);
  }
  return ids;
}

function collectUserIds(
  skills: ReadonlyMap<string, SnapshotDocument>,
  packages: ReadonlyMap<string, SnapshotDocument>,
) {
  const ids = new Set<string>();
  for (const doc of [...skills.values(), ...packages.values()]) {
    if (typeof doc.ownerUserId === "string") ids.add(doc.ownerUserId);
  }
  return ids;
}

function collectPublisherIds(
  skills: ReadonlyMap<string, SnapshotDocument>,
  packages: ReadonlyMap<string, SnapshotDocument>,
) {
  const ids = new Set<string>();
  for (const doc of [...skills.values(), ...packages.values()]) {
    if (typeof doc.ownerPublisherId === "string") ids.add(doc.ownerPublisherId);
  }
  return ids;
}

async function selectUsers(
  input: string,
  userIds: ReadonlySet<string>,
  publisherIds: ReadonlySet<string>,
) {
  const rows = new Map<string, SnapshotDocument>();
  for await (const doc of readSnapshotTable(input, "users")) {
    if (!userIds.has(doc._id)) continue;
    if (typeof doc.personalPublisherId === "string" && !publisherIds.has(doc.personalPublisherId)) {
      delete doc.personalPublisherId;
    }
    rows.set(doc._id, doc);
  }
  assertAllDocumentsFound("users", userIds, rows);
  return rows;
}

async function selectPublishers(
  input: string,
  publisherIds: ReadonlySet<string>,
  userIds: ReadonlySet<string>,
) {
  const rows = new Map<string, SnapshotDocument>();
  for await (const doc of readSnapshotTable(input, "publishers")) {
    if (!publisherIds.has(doc._id)) continue;
    if (typeof doc.linkedUserId === "string" && !userIds.has(doc.linkedUserId)) {
      delete doc.linkedUserId;
    }
    rows.set(doc._id, doc);
  }
  assertAllDocumentsFound("publishers", publisherIds, rows);
  return rows;
}

async function selectStorageDocs(input: string, storageIds: ReadonlySet<string>) {
  const rows = new Map<string, SnapshotDocument>();
  for await (const doc of readSnapshotTable(input, "_storage")) {
    if (storageIds.has(doc._id)) rows.set(doc._id, doc);
  }
  assertAllDocumentsFound("_storage", storageIds, rows);
  return rows;
}

async function sanitizeStorageFiles(
  input: string,
  bundleDir: string,
  entries: ReadonlyMap<string, string>,
  storageDocs: Map<string, SnapshotDocument>,
) {
  const outputStorageDir = join(bundleDir, "_storage");
  await mkdir(outputStorageDir, { recursive: true });
  const storageIdsByEntry = new Map([...entries].map(([storageId, entry]) => [entry, storageId]));
  for await (const { entry, bytes: source } of readSelectedSnapshotEntries(
    input,
    new Set(entries.values()),
  )) {
    const storageId = storageIdsByEntry.get(entry);
    if (!storageId) throw new Error(`Unexpected storage entry: ${entry}`);
    const outputPath = join(outputStorageDir, basename(entry));
    const sanitized = sanitizePublicText(source.toString("utf8"));
    await writeFile(outputPath, sanitized, "utf8");
    const bytes = Buffer.byteLength(sanitized, "utf8");
    const sha256 = createHash("sha256").update(sanitized).digest();
    const storageDoc = storageDocs.get(storageId);
    if (!storageDoc) throw new Error(`Missing storage document for ${storageId}`);
    storageDoc.size = bytes;
    storageDoc.sha256 = sha256.toString("base64");
  }
}

function updateArtifactFileMetadata(
  artifacts: ReadonlyMap<string, SelectedArtifact>,
  storageDocs: ReadonlyMap<string, SnapshotDocument>,
) {
  for (const artifact of artifacts.values()) {
    artifact.files = artifact.files.map((file) => {
      const storage = storageDocs.get(file.storageId);
      if (!storage) throw new Error(`Missing sanitized storage metadata for ${file.storageId}`);
      return {
        ...file,
        size: storage.size as number,
        sha256: Buffer.from(storage.sha256 as string, "base64").toString("hex"),
      };
    });
  }
}

async function copyDerivedTable(
  input: string,
  bundleDir: string,
  table: string,
  parents: ReadonlyMap<string, SnapshotDocument>,
  key: "skillId" | "packageId",
) {
  const tableDir = join(bundleDir, table);
  let writer: ReturnType<typeof createWriteStream> | null = null;
  try {
    for await (const doc of readSnapshotTable(input, table)) {
      const parentId = doc[key];
      if (typeof parentId !== "string") continue;
      const parent = parents.get(parentId);
      if (!parent) continue;
      if (!writer) {
        await mkdir(tableDir, { recursive: true });
        writer = createWriteStream(join(tableDir, "documents.jsonl"), { encoding: "utf8" });
      }
      const row = sanitizeDerivedSnapshot(doc, parent, key === "skillId" ? "skill" : "package");
      if (!writer.write(`${JSON.stringify(row)}\n`)) await once(writer, "drain");
    }
  } catch (error) {
    writer?.destroy();
    if (isMissingSnapshotEntryError(error)) {
      await rm(tableDir, { recursive: true, force: true });
      return;
    }
    throw error;
  }
  if (writer) {
    await new Promise<void>((resolvePromise, reject) => {
      writer!.once("error", reject);
      writer!.end(resolvePromise);
    });
  }
}

async function writeTable(
  bundleDir: string,
  table: string,
  rows: Iterable<SnapshotDocument | Record<string, unknown>>,
  _input: string,
) {
  const tableDir = join(bundleDir, table);
  await mkdir(tableDir, { recursive: true });
  const writer = createWriteStream(join(tableDir, "documents.jsonl"), { encoding: "utf8" });
  for (const row of rows) writer.write(`${JSON.stringify(row)}\n`);
  await new Promise<void>((resolvePromise, reject) => {
    writer.once("error", reject);
    writer.end(resolvePromise);
  });
}

async function writeStorageDocuments(
  bundleDir: string,
  rows: ReadonlyMap<string, SnapshotDocument>,
) {
  const writer = createWriteStream(join(bundleDir, "_storage", "documents.jsonl"), {
    encoding: "utf8",
  });
  for (const row of rows.values()) writer.write(`${JSON.stringify(row)}\n`);
  await new Promise<void>((resolvePromise, reject) => {
    writer.once("error", reject);
    writer.end(resolvePromise);
  });
}

async function writeTablesMetadata(bundleDir: string, input: string) {
  const tables = (await import("node:fs/promises")).readdir(bundleDir, { withFileTypes: true });
  const names = new Set(
    (await tables)
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .filter((name) => name !== "_storage"),
  );
  const rows: SnapshotDocument[] = [];
  for await (const row of readSnapshotTable(input, "_tables")) {
    if (typeof row.name === "string" && names.has(row.name)) rows.push(row);
  }
  const missing = [...names].filter((name) => !rows.some((row) => row.name === name));
  if (missing.length > 0) {
    throw new Error(`Snapshot table metadata is missing: ${missing.join(", ")}`);
  }
  const tableDir = join(bundleDir, "_tables");
  await mkdir(tableDir, { recursive: true });
  await writeFile(
    join(tableDir, "documents.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

async function writeManifest(
  outputPath: string,
  input: string,
  skills: number,
  packages: number,
  storageFiles: number,
) {
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        sourceSnapshot: basename(input),
        skills,
        packages,
        storageFiles,
      },
      null,
      2,
    )}\n`,
  );
}

function assertAllStorageFound(wanted: ReadonlySet<string>, entries: ReadonlyMap<string, string>) {
  const missing = [...wanted].filter((id) => !entries.has(id));
  if (missing.length > 0) {
    throw new Error(`Snapshot is missing ${missing.length} selected storage files`);
  }
}

function assertAllDocumentsFound(
  table: string,
  wanted: ReadonlySet<string>,
  rows: ReadonlyMap<string, SnapshotDocument>,
) {
  const missing = [...wanted].filter((id) => !rows.has(id));
  if (missing.length > 0) {
    throw new Error(`${table} is missing ${missing.length} referenced documents`);
  }
}

function isMissingSnapshotEntryError(error: unknown) {
  return error instanceof Error && error.message.includes("filename not matched");
}

function parseArgs(args: string[]): Options {
  let input = "";
  let output = "";
  let keepWorkDir = false;
  let limit: number | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") input = args[++index] ?? "";
    else if (arg === "--output") output = args[++index] ?? "";
    else if (arg === "--limit") limit = Number.parseInt(args[++index] ?? "", 10);
    else if (arg === "--keep-work-dir") keepWorkDir = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!input) throw new Error("--input is required");
  if (!output) throw new Error("--output is required");
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
  return { input, output, keepWorkDir, limit };
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
