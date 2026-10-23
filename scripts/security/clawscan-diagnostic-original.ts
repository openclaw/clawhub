import { createHash } from "node:crypto";
import { extractDiagnosticArchive, type DiagnosticManifest } from "./clawscan-diagnostic-input";
import original175 from "./fixtures/judge-original-175.json";
import original290 from "./fixtures/judge-original-290.json";

export const ORIGINAL_BASELINE_SOURCE = "9662307780b2834791e2b0be8b166b44f4144ef4";
export const ORIGINAL_CANDIDATE_SOURCE: string | null = "fd5f18ad3365f623d4165740b124cd7f142d0556";
export const ORIGINAL_MAXIMUM_BYTES = 16 * 1024 * 1024;
export type OriginalFixture = "175" | "290";
export type OriginalMode =
  | "original-scanner-only"
  | "original-candidate-full"
  | "original-candidate-290-full";
export const originalManifests: Record<OriginalFixture, DiagnosticManifest> = {
  "175": { ...original175, manifestCanonicalization: "path,size,sha256" },
  "290": { ...original290, manifestCanonicalization: "path,size,sha256" },
};
export const originalSources = {
  "175": {
    archive: "https://clawhub.ai/api/v1/download?slug=siluzan-tso&version=1.1.57",
    metadata: "https://clawhub.ai/api/v1/skills/siluzan-tso/file?version=1.1.57&path=_meta.json",
  },
  "290": {
    archive:
      "https://clawhub.ai/api/v1/download?slug=slide-maker&version=6.0.0&ownerHandle=dong845",
    metadata: null,
  },
} as const;

export function originalDiagnosticCases(mode: OriginalMode) {
  if (mode === "original-scanner-only")
    return [
      { id: "baseline175", source: "baseline", fixture: "175" },
      { id: "candidate175", source: "candidate", fixture: "175" },
      { id: "baseline290", source: "baseline", fixture: "290" },
      { id: "candidate290", source: "candidate", fixture: "290" },
    ] as const;
  if (mode === "original-candidate-full")
    return [
      { id: "candidate175", source: "candidate", fixture: "175" },
      { id: "candidate290", source: "candidate", fixture: "290" },
    ] as const;
  if (mode === "original-candidate-290-full")
    return [{ id: "candidate290", source: "candidate", fixture: "290" }] as const;
  throw new Error("Invalid original diagnostic mode");
}

export async function downloadOriginalInput(fixture: OriginalFixture) {
  const download = async (url: string, limit: number) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
    if (!response.ok || !response.body) throw new Error("Original diagnostic download failed");
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      if (total > limit) throw new Error("Original diagnostic download exceeded limit");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  };
  const selected = originalSources[fixture];
  if (!selected) throw new Error("Invalid original diagnostic fixture");
  const archive = await download(selected.archive, 10 * 1024 * 1024);
  if (
    createHash("sha256").update(archive).digest("hex") !== originalManifests[fixture].archiveSha256
  )
    throw new Error("Original diagnostic archive identity mismatch");
  const metadata = selected.metadata ? await download(selected.metadata, 83) : undefined;
  return { archive, metadata };
}

export async function materializeOriginalInput(
  fixture: OriginalFixture,
  input: { archive: Buffer; metadata?: Buffer },
  target: string,
) {
  if (fixture === "175" && input.metadata === undefined)
    throw new Error("Missing original metadata");
  return extractDiagnosticArchive(input.archive, target, originalManifests[fixture], {
    maximumBytes: ORIGINAL_MAXIMUM_BYTES,
    excludedEntries: fixture === "175" ? [] : ["_meta.json"],
    restoredMetadata: fixture === "175" ? input.metadata : undefined,
  });
}
