import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fromBufferPromise } from "yauzl";
import receiptIncident from "./fixtures/judge-receipt-incident.json";
import smallTimeout from "./fixtures/judge-small-timeout.json";
import incident from "./fixtures/judge-timeout-incident.json";

export const INCIDENT_ARCHIVE_URL =
  "https://clawhub.ai/api/v1/download?slug=chinese-official-writing&version=2.0.43";
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
export type DiagnosticManifest = {
  archiveSha256: string;
  manifestSha256: string;
  manifestCanonicalization?: "path,size,sha256";
  files: { path: string; sha256: string; size: number }[];
};
export const incidentManifest: DiagnosticManifest = incident;
export const receiptIncidentManifest: DiagnosticManifest = receiptIncident;
export const smallTimeoutManifest: DiagnosticManifest = smallTimeout;
const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const safePath = (path: string) =>
  path.length > 0 &&
  path.length < 500 &&
  !/[\\:]/.test(path) &&
  !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
  path.split("/").every((part) => part && part !== "." && part !== "..");

type ExtractionOptions = {
  maximumBytes?: number;
  excludedEntries?: string[];
  restoredMetadata?: Buffer;
};

function validateManifest(manifest: DiagnosticManifest, maximumBytes = MAX_ARCHIVE_BYTES) {
  const files = manifest.files
    .map(({ path, sha256, size }) =>
      manifest.manifestCanonicalization === "path,size,sha256"
        ? { path, size, sha256 }
        : { path, sha256, size },
    )
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > 16 * 1024 * 1024 ||
    (manifest.manifestCanonicalization !== undefined &&
      manifest.manifestCanonicalization !== "path,size,sha256") ||
    !/^[a-f0-9]{64}$/.test(manifest.archiveSha256) ||
    hash(JSON.stringify(files)) !== manifest.manifestSha256 ||
    new Set(files.map((file) => file.path)).size !== files.length ||
    files.some(
      (file) =>
        !safePath(file.path) ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0,
    ) ||
    files.reduce((sum, file) => sum + file.size, 0) > maximumBytes
  )
    throw new Error("Invalid diagnostic manifest");
}

export async function verifyDiagnosticTree(
  root: string,
  manifest: DiagnosticManifest,
  maximumBytes = MAX_ARCHIVE_BYTES,
) {
  validateManifest(manifest, maximumBytes);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("Invalid diagnostic root");
  const directories = new Set(
    manifest.files.flatMap((file) =>
      file.path
        .split("/")
        .slice(0, -1)
        .map((_, index) =>
          file.path
            .split("/")
            .slice(0, index + 1)
            .join("/"),
        ),
    ),
  );
  const observed: string[] = [];
  const walk = async (directory: string, prefix: string) => {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error("Invalid diagnostic file type");
      if (info.isDirectory()) {
        if (!directories.has(`${prefix}${name}`))
          throw new Error("Unexpected diagnostic directory");
        await walk(path, `${prefix}${name}/`);
      } else if (info.isFile()) observed.push(`${prefix}${name}`);
      else throw new Error("Invalid diagnostic file type");
    }
  };
  await walk(root, "");
  if (
    observed.sort().join("\n") !==
    manifest.files
      .map((file) => file.path)
      .sort()
      .join("\n")
  )
    throw new Error("Diagnostic file set mismatch");
  for (const file of manifest.files) {
    const bytes = await readFile(join(root, file.path));
    if (bytes.length !== file.size || hash(bytes) !== file.sha256)
      throw new Error("Diagnostic file identity mismatch");
  }
  return {
    files: manifest.files.length,
    bytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
    manifestSha256: manifest.manifestSha256,
  };
}

export async function extractDiagnosticArchive(
  bytes: Buffer,
  root: string,
  manifest = incidentManifest,
  options: ExtractionOptions = {},
) {
  const maximumBytes = options.maximumBytes ?? MAX_ARCHIVE_BYTES;
  validateManifest(manifest, maximumBytes);
  if (bytes.length > MAX_ARCHIVE_BYTES || hash(bytes) !== manifest.archiveSha256)
    throw new Error("Diagnostic archive identity mismatch");
  const zip = await fromBufferPromise(bytes, {
    lazyEntries: true,
    autoClose: false,
    strictFileNames: true,
  });
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  const extras = new Set(options.excludedEntries ?? ["_meta.json", "skill-card.md"]);
  if ([...extras].some((path) => !safePath(path) || expected.has(path)))
    throw new Error("Invalid diagnostic exclusions");
  const metadata = expected.get("_meta.json");
  if (
    options.restoredMetadata !== undefined &&
    (!metadata ||
      options.restoredMetadata.length !== metadata.size ||
      hash(options.restoredMetadata) !== metadata.sha256)
  )
    throw new Error("Diagnostic original metadata identity mismatch");
  const seen = new Set<string>();
  const originals: { path: string; bytes: Buffer }[] = [];
  let archiveUncompressedBytes = 0;
  try {
    if (zip.entryCount !== expected.size + extras.size)
      throw new Error("Diagnostic archive inventory mismatch");
    for await (const entry of zip.eachEntry()) {
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        !safePath(entry.fileName) ||
        seen.has(entry.fileName) ||
        (mode !== 0 && mode !== 0o100000) ||
        entry.externalFileAttributes & 0x10 ||
        entry.generalPurposeBitFlag & 1 ||
        !entry.canDecodeFileData()
      )
        throw new Error("Invalid diagnostic archive entry");
      seen.add(entry.fileName);
      archiveUncompressedBytes += entry.uncompressedSize;
      if (archiveUncompressedBytes > maximumBytes + 64 * 1024)
        throw new Error("Diagnostic archive size mismatch");
      const file = expected.get(entry.fileName);
      if (!file && !extras.has(entry.fileName))
        throw new Error("Unexpected diagnostic archive entry");
      if (!file) continue;
      if (entry.fileName === "_meta.json" && options.restoredMetadata !== undefined) {
        if (entry.uncompressedSize > 64 * 1024)
          throw new Error("Diagnostic archive metadata size mismatch");
        originals.push({ path: file.path, bytes: options.restoredMetadata });
        continue;
      }
      if (entry.uncompressedSize !== file.size) throw new Error("Diagnostic archive size mismatch");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of stream) {
        total += chunk.length;
        if (total > file.size) {
          stream.destroy();
          throw new Error("Diagnostic archive size mismatch");
        }
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      if (total !== file.size || hash(data) !== file.sha256)
        throw new Error("Diagnostic archive file identity mismatch");
      originals.push({ path: file.path, bytes: data });
    }
  } finally {
    zip.close();
  }
  if (originals.length !== expected.size || seen.size !== expected.size + extras.size)
    throw new Error("Diagnostic archive inventory mismatch");
  await mkdir(root, { recursive: false, mode: 0o700 });
  for (const file of originals) {
    await mkdir(dirname(join(root, file.path)), { recursive: true, mode: 0o700 });
    await writeFile(join(root, file.path), file.bytes, { flag: "wx", mode: 0o400 });
  }
  const identity = await verifyDiagnosticTree(root, manifest, maximumBytes);
  const lockDirectories = async (directory: string) => {
    for (const name of await readdir(directory))
      if ((await lstat(join(directory, name))).isDirectory())
        await lockDirectories(join(directory, name));
    await chmod(directory, 0o500);
  };
  await lockDirectories(root);
  return identity;
}

export async function downloadIncidentArchive(
  fixture: "incident" | "receipt-incident" | "small-timeout-paired" = "incident",
) {
  const url =
    fixture === "small-timeout-paired"
      ? "https://clawhub.ai/api/v1/download?slug=fitatu-diary&version=1.1.1"
      : fixture === "receipt-incident"
        ? "https://clawhub.ai/api/v1/download?slug=onlinewebdirectory&version=1.0.1"
        : INCIDENT_ARCHIVE_URL;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (!response.ok || !response.body) throw new Error("Diagnostic archive download failed");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_ARCHIVE_BYTES) throw new Error("Diagnostic archive download exceeded limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
