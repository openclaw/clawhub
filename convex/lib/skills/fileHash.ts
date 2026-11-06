import { sha256Hex } from "../hash";
export { toHex } from "../hash";
const encoder = new TextEncoder();

export async function hashSkillFiles(files: Array<{ path: string; sha256: string }>) {
  const normalized = files
    .filter((file) => Boolean(file.path) && Boolean(file.sha256))
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const payload = normalized.map((file) => `${file.path}:${file.sha256}`).join("\n");
  return sha256Hex(encoder.encode(payload));
}
