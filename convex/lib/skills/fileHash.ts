const encoder = new TextEncoder();

export async function hashSkillFiles(files: Array<{ path: string; sha256: string }>) {
  const normalized = files
    .filter((file) => Boolean(file.path) && Boolean(file.sha256))
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const payload = normalized.map((file) => `${file.path}:${file.sha256}`).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
  return toHex(new Uint8Array(digest));
}

export function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
