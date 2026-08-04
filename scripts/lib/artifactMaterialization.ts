import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { safeWorkerArtifactPathLabel } from "./workerRedaction";

type ArtifactFile = {
  path: string;
  sha256: string;
  size: number;
};

function safeArtifactOutputPath(artifactRoot: string, artifactPath: string) {
  const normalized = artifactPath.replace(/^\/+/, "");
  const out = resolve(artifactRoot, normalized);
  const root = resolve(artifactRoot);
  if (!out.startsWith(`${root}${sep}`) && out !== root) {
    throw new Error(`Unsafe artifact path: ${safeWorkerArtifactPathLabel(artifactPath)}`);
  }
  return out;
}

export async function materializeVerifiedArtifactFiles<T extends ArtifactFile>(input: {
  artifactRoot: string;
  download: (file: T) => Promise<Uint8Array>;
  files: T[];
}) {
  const candidates = input.files.map((file) => ({
    file,
    out: safeArtifactOutputPath(input.artifactRoot, file.path),
  }));

  for (const candidate of candidates) {
    // Zero-byte entries are directories only when another stored path proves it.
    // Otherwise they are real empty files and must still be downloaded and verified.
    const isDirectoryMarker =
      candidate.file.size === 0 &&
      candidates.some(
        (other) => other.out !== candidate.out && other.out.startsWith(`${candidate.out}${sep}`),
      );
    if (isDirectoryMarker) continue;

    const bytes = await input.download(candidate.file);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== candidate.file.sha256.toLowerCase()) {
      throw new Error(
        `Downloaded artifact hash mismatch for artifact file ${safeWorkerArtifactPathLabel(candidate.file.path)}`,
      );
    }
    await mkdir(dirname(candidate.out), { recursive: true });
    await writeFile(candidate.out, bytes);
  }
}
