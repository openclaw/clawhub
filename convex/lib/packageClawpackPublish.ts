import type { PackagePublishMetadata, ServerPackagePublishRequest } from "clawhub-schema";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { parseClawPack, sha256Hex } from "./clawpack";
import { tryNormalizePackageName } from "./packageRegistry";
import {
  getClawPackSizeError,
  getPublishTotalSizeError,
  MAX_CLAWPACK_BYTES,
  MAX_PUBLISH_TOTAL_BYTES,
} from "./publishLimits";

type StoredPackagePublishFile = ServerPackagePublishRequest["files"][number];
type PackagePublishTarballArtifact = NonNullable<ServerPackagePublishRequest["artifact"]>;
type ParsedPackageClawPack = Awaited<ReturnType<typeof parseClawPack>>;

export function defaultStoredPackageContentType() {
  return "application/octet-stream";
}

export function bytesToArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function storeRequestPackageBlob(
  ctx: ActionCtx,
  requestStorageIds: Set<Id<"_storage">>,
  blob: Blob,
) {
  const storageId = await ctx.storage.store(blob);
  requestStorageIds.add(storageId);
  return storageId;
}

export async function settlePackageFileStores(stores: Array<Promise<StoredPackagePublishFile>>) {
  // A rejected store does not cancel its siblings. Wait before reclaiming their blobs.
  const results = await Promise.allSettled(stores);
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

async function storeClawPackFile(
  ctx: ActionCtx,
  entry: { path: string; bytes: Uint8Array },
  requestStorageIds: Set<Id<"_storage">>,
): Promise<StoredPackagePublishFile> {
  const contentType = defaultStoredPackageContentType();
  const storageId = await storeRequestPackageBlob(
    ctx,
    requestStorageIds,
    new Blob([bytesToArrayBuffer(entry.bytes)], { type: contentType }),
  );
  return {
    path: entry.path,
    size: entry.bytes.byteLength,
    storageId,
    sha256: await sha256Hex(entry.bytes),
    contentType,
  };
}

// Convex actions have a tight memory ceiling, so bound in-flight Blob copies by
// bytes as well as count. Storing thousands of small files one at a time
// otherwise pushes large ClawPacks past clients' publish request timeouts.
const CLAWPACK_STORE_BATCH_BYTES = 8 * 1024 * 1024;
const CLAWPACK_STORE_BATCH_FILES = 16;

async function storeClawPackFiles(
  ctx: ActionCtx,
  entries: Array<{ path: string; bytes: Uint8Array }>,
  requestStorageIds: Set<Id<"_storage">>,
) {
  const files: StoredPackagePublishFile[] = [];
  let batch: Array<{ path: string; bytes: Uint8Array }> = [];
  let batchBytes = 0;
  const flush = async () => {
    files.push(
      ...(await settlePackageFileStores(
        batch.map((entry) => storeClawPackFile(ctx, entry, requestStorageIds)),
      )),
    );
    batch = [];
    batchBytes = 0;
  };
  for (const entry of entries) {
    const overflows =
      batch.length >= CLAWPACK_STORE_BATCH_FILES ||
      batchBytes + entry.bytes.byteLength > CLAWPACK_STORE_BATCH_BYTES;
    if (batch.length > 0 && overflows) await flush();
    batch.push(entry);
    batchBytes += entry.bytes.byteLength;
  }
  if (batch.length > 0) await flush();
  return files;
}

export async function readStoredPackageTarball(ctx: ActionCtx, storageId: Id<"_storage">) {
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new Error("Package tarball upload no longer exists");
  if (blob.size > MAX_CLAWPACK_BYTES) {
    throw new Error(getClawPackSizeError("uploaded ClawPack"));
  }
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildPackagePublishRequestFromClawPack(
  ctx: ActionCtx,
  metadata: PackagePublishMetadata,
  parsed: ParsedPackageClawPack,
  artifactBytes: Uint8Array,
  artifactStorageId: Id<"_storage">,
  requestStorageIds: Set<Id<"_storage">>,
): Promise<ServerPackagePublishRequest> {
  if (parsed.unpackedSize > MAX_PUBLISH_TOTAL_BYTES) {
    throw new Error(getPublishTotalSizeError("package"));
  }
  const artifact: PackagePublishTarballArtifact = {
    kind: "npm-pack",
    storageId: artifactStorageId,
    sha256: parsed.artifactSha256,
    size: artifactBytes.byteLength,
    format: "tgz",
    npmIntegrity: parsed.npmIntegrity,
    npmShasum: parsed.npmShasum,
    npmTarballName: parsed.npmTarballName,
    npmUnpackedSize: parsed.unpackedSize,
    npmFileCount: parsed.fileCount,
  };
  const files = await storeClawPackFiles(ctx, parsed.entries, requestStorageIds);
  return { ...metadata, files, artifact };
}

export function assertClawPackPublicationIdentity(
  metadata: PackagePublishMetadata,
  parsed: ParsedPackageClawPack,
) {
  if (metadata.family !== "template") return;
  const expectedName = tryNormalizePackageName(metadata.name);
  if (!expectedName || parsed.packageName !== expectedName) {
    throw new Error(
      `Template package name mismatch: expected ${expectedName ?? metadata.name}, got ${parsed.packageName}`,
    );
  }
  const expectedVersion = metadata.version.trim();
  if (parsed.packageVersion !== expectedVersion) {
    throw new Error(
      `Template package version mismatch: expected ${expectedVersion}, got ${parsed.packageVersion}`,
    );
  }
  const expectedDigest = metadata.expectedArtifactSha256?.trim().toLowerCase();
  if (!expectedDigest) throw new Error("Template publication requires expectedArtifactSha256");
  if (expectedDigest !== parsed.artifactSha256) {
    throw new Error(
      `Template artifact SHA-256 mismatch: expected ${expectedDigest}, got ${parsed.artifactSha256}`,
    );
  }
}
