import { createHash } from "node:crypto";

export function hashFileInventory(files: Array<{ relPath: string; bytes: Uint8Array }>) {
  return files.map((file) => ({
    path: file.relPath,
    sha256: createHash("sha256").update(file.bytes).digest("hex"),
    size: file.bytes.byteLength,
  }));
}

export function buildGitHubFolderContentHash(
  files: Array<{ path: string; sha256: string; size: number }>,
) {
  const payload = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}\0${file.size}\0${file.sha256.toLowerCase()}`)
    .join("\n");
  return createHash("sha256").update(payload).digest("hex");
}
