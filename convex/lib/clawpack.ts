import { toHex } from "./hash";
export { sha256Hex } from "./hash";
import { parseClawPack as parseClawPackContents } from "../../packages/clawhub/src/clawpack";

type ParsedClawPack = ReturnType<typeof parseClawPackContents> & {
  artifactSha256: string;
  npmIntegrity: string;
  npmShasum: string;
  npmTarballName: string;
  unpackedSize: number;
  fileCount: number;
};

async function digestBytes(algorithm: "SHA-1" | "SHA-256" | "SHA-512", bytes: Uint8Array) {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest(algorithm, input);
  return new Uint8Array(digest);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function npmTarballName(packageName: string, version: string) {
  const normalizedName = packageName.replace(/^@/, "").replace("/", "-");
  return `${normalizedName}-${version}.tgz`;
}

export async function sha256Base64(bytes: Uint8Array) {
  return toBase64(await digestBytes("SHA-256", bytes));
}

export async function parseClawPack(bytes: Uint8Array): Promise<ParsedClawPack> {
  const [sha256, sha1, sha512] = await Promise.all([
    digestBytes("SHA-256", bytes),
    digestBytes("SHA-1", bytes),
    digestBytes("SHA-512", bytes),
  ]);

  const { packageName, packageVersion, entries, packageJson, pluginManifest } =
    parseClawPackContents(bytes);

  return {
    artifactSha256: toHex(sha256),
    npmIntegrity: `sha512-${toBase64(sha512)}`,
    npmShasum: toHex(sha1),
    npmTarballName: npmTarballName(packageName, packageVersion),
    packageName,
    packageVersion,
    unpackedSize: entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0),
    fileCount: entries.length,
    entries,
    packageJson,
    ...(pluginManifest ? { pluginManifest } : {}),
  };
}
