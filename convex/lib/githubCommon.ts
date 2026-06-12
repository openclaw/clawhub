const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

export function normalizeGitHubRepo(value: string) {
  const trimmed = value
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "")
    .replace(/^git@github\.com:/i, "https://github.com/");
  if (!trimmed) return null;

  const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (shorthand) return `${shorthand[1]}/${shorthand[2]}`;

  try {
    const url = new URL(trimmed);
    if (!GITHUB_HOSTS.has(url.hostname)) return null;
    const segments = decodePathSegments(url.pathname);
    const owner = segments[0] ?? "";
    const repo = (segments[1] ?? "").replace(/\.git$/i, "");
    if (!owner || !repo) return null;
    return `${owner}/${repo}`;
  } catch {
    return null;
  }
}

export function isRepoPathUnderRoot(path: string, root: string) {
  if (!root) return true;
  return path === root || path.startsWith(`${root}/`);
}

export async function createGitHubAppJwt(params: {
  appId: string;
  privateKeyPem: string;
  now?: number;
}) {
  const nowSeconds = Math.floor((params.now ?? Date.now()) / 1000);
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iat: nowSeconds - 60,
        exp: nowSeconds + 9 * 60,
        iss: params.appId,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(params.privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function sha256Hex(value: string) {
  return toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  );
}

export async function hmacSha256Base64Url(secret: string, value: string) {
  const digest = await hmacSha256(secret, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, value: ArrayBuffer) {
  const digest = await hmacSha256(secret, value);
  return toHex(new Uint8Array(digest));
}

export function timingSafeEqual(a: string, b: string) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export function base64UrlEncode(bytes: Uint8Array) {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return base64Decode(padded);
}

function decodePathSegments(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

async function importPrivateKey(privateKeyPem: string) {
  const normalized = privateKeyPem.replace(/\\n/g, "\n").trim();
  const pkcs8Match = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(
    normalized,
  );
  const pkcs1Match = /-----BEGIN RSA PRIVATE KEY-----([\s\S]+?)-----END RSA PRIVATE KEY-----/.exec(
    normalized,
  );
  const der = pkcs8Match
    ? base64Decode(pkcs8Match[1]?.replace(/\s+/g, "") ?? "")
    : pkcs1Match
      ? wrapPkcs1RsaPrivateKeyAsPkcs8(base64Decode(pkcs1Match[1]?.replace(/\s+/g, "") ?? ""))
      : base64Decode(normalized.replace(/\s+/g, ""));
  return await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(der),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function wrapPkcs1RsaPrivateKeyAsPkcs8(pkcs1Der: Uint8Array) {
  const rsaEncryptionOid = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const privateKey = derEncode(0x04, pkcs1Der);
  return derEncode(0x30, concatBytes([version, rsaEncryptionOid, privateKey]));
}

function derEncode(tag: number, value: Uint8Array) {
  return concatBytes([new Uint8Array([tag]), derLength(value.byteLength), value]);
}

function derLength(length: number) {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function hmacSha256(secret: string, value: ArrayBuffer | Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign("HMAC", key, toArrayBuffer(value));
}

function base64Decode(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function toArrayBuffer(value: ArrayBuffer | Uint8Array) {
  if (value instanceof ArrayBuffer) return value;
  return new Uint8Array(value).buffer as ArrayBuffer;
}
