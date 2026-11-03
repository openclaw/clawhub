import { createHash } from "node:crypto";
import { fromBufferPromise } from "yauzl";
import { extractDiagnosticArchive } from "./clawscan-diagnostic-input";
import runtime from "./fixtures/judge-original-038-runtime.json";
import original from "./fixtures/judge-original-038.json";

export const ORIGINAL038_SOURCE = runtime.source;
export const original038Manifest = { ...original, archiveSha256: "0".repeat(64) };
if (
  original.files.length !== 26 ||
  original.files.reduce((sum, file) => sum + file.size, 0) !== 3_862_533 ||
  original.manifestSha256 !== "ea3f5eb2634dffda246aacd1798f9d4915b0cd223feeb2cd7de35e9d3856c6c8" ||
  createHash("sha256").update(JSON.stringify(original.files)).digest("hex") !==
    original.manifestSha256
)
  throw new Error("Fixed original038 custody fixture differs from retained originals");
export const ORIGINAL038_DOWNLOAD =
  "https://clawhub.ai/api/v1/download?slug=sn-ppt-workbench&version=2026.10.29";

export function validateOriginal038Packages(kind: "skillspector" | "aig", value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid fixed-original dependency inventory");
  const expected = runtime.expectedPackages[kind];
  const actual = value as Record<string, unknown>;
  if (
    Object.keys(actual).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([name, version]) => actual[name] !== version)
  )
    throw new Error("Fixed-original dependencies differ from production contract");
  return expected;
}

export async function materializeOriginal038(archive: Buffer, target: string) {
  const transferSha256 = createHash("sha256").update(archive).digest("hex");
  // The public ZIP is a transfer container. Identity belongs to all 26 retained files.
  const zip = await fromBufferPromise(archive, {
    lazyEntries: true,
    strictFileNames: true,
    autoClose: false,
  });
  const extras: string[] = [];
  try {
    if (zip.entryCount < 26 || zip.entryCount > 28)
      throw new Error("Fixed original archive inventory mismatch");
    for await (const entry of zip.eachEntry()) {
      if (["_meta.json", "skill-card.md"].includes(entry.fileName)) {
        if (entry.uncompressedSize > 64 * 1024)
          throw new Error("Fixed original generated metadata exceeds limit");
        extras.push(entry.fileName);
      }
    }
  } finally {
    zip.close();
  }
  const identity = await extractDiagnosticArchive(
    archive,
    target,
    { ...original038Manifest, archiveSha256: transferSha256 },
    { maximumBytes: 16 * 1024 * 1024, excludedEntries: extras },
  );
  return { ...identity, transferSha256, originalCompressedArchiveIdentityProven: false };
}

export async function downloadOriginal038() {
  const response = await fetch(ORIGINAL038_DOWNLOAD, {
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (!response.ok || !response.body) throw new Error("Fixed original public download unavailable");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 10 * 1024 * 1024) throw new Error("Fixed original archive exceeds limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
