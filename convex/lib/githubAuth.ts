const GITHUB_API = "https://api.github.com";
const DEFAULT_ACCEPT = "application/vnd.github+json";
const DEFAULT_USER_AGENT = "clawhub/github-api";
const APP_TOKEN_CACHE_BUFFER_MS = 60 * 1000;

type FetchImpl = typeof fetch;

type GitHubAppConfig = {
  appId: string;
  installationId: string;
  privateKey: string;
};

type InstallationToken = {
  token: string;
  expiresAt: number;
  permissions: Record<string, string>;
};

type CachedInstallationToken = InstallationToken & {
  cacheKey: string;
};

let cachedInstallationToken: CachedInstallationToken | null = null;

export function isGitHubAppConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(readGitHubAppConfig(env));
}

export async function buildGitHubApiHeaders(options: {
  userAgent: string;
  accept?: string;
  fetchImpl?: FetchImpl;
  allowAnonymous?: boolean;
  useGitHubApp?: boolean;
}): Promise<Record<string, string>> {
  const headers = buildGitHubHeaders({
    userAgent: options.userAgent,
    accept: options.accept,
  });

  if (options.useGitHubApp !== false) {
    const appToken = await getCachedGitHubAppInstallationToken({
      fetchImpl: options.fetchImpl,
      userAgent: options.userAgent,
    });
    if (appToken) {
      headers.Authorization = `Bearer ${appToken}`;
      return headers;
    }
  }

  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  if (options.allowAnonymous === false) {
    throw new Error("GitHub API authentication is not configured");
  }
  return headers;
}

export function buildGitHubHeaders(options: {
  userAgent: string;
  accept?: string;
  token?: string;
  isAppJwt?: boolean;
}) {
  const headers: Record<string, string> = {
    Accept: options.accept ?? DEFAULT_ACCEPT,
    "User-Agent": options.userAgent,
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  return headers;
}

export async function createGitHubAppInstallationToken(
  options: {
    fetchImpl?: FetchImpl;
    userAgent?: string;
    env?: NodeJS.ProcessEnv;
    now?: number;
  } = {},
): Promise<InstallationToken> {
  const env = options.env ?? process.env;
  const config = readGitHubAppConfig(env);
  if (!config) throw new Error("GitHub App credentials missing");

  const jwt = await createGitHubAppJwt(config.appId, config.privateKey, options.now ?? Date.now());
  const response = await (options.fetchImpl ?? fetch)(
    `${GITHUB_API}/app/installations/${config.installationId}/access_tokens`,
    {
      method: "POST",
      headers: buildGitHubHeaders({
        userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
        token: jwt,
        isAppJwt: true,
      }),
    },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub App token failed: ${message}`);
  }

  const payload = (await response.json()) as {
    token?: string;
    expires_at?: string;
    permissions?: Record<string, string>;
  };
  const token = payload.token?.trim();
  if (!token) throw new Error("GitHub App token missing");
  const expiresAt = payload.expires_at ? Date.parse(payload.expires_at) : Number.NaN;
  if (!Number.isFinite(expiresAt)) throw new Error("GitHub App token expiry missing");
  return { token, expiresAt, permissions: payload.permissions ?? {} };
}

async function getCachedGitHubAppInstallationToken(options: {
  fetchImpl?: FetchImpl;
  userAgent: string;
}) {
  const config = readGitHubAppConfig(process.env);
  if (!config) return null;

  const now = Date.now();
  const cacheKey = `${config.appId}:${config.installationId}:${hashCacheKey(config.privateKey)}`;
  if (
    cachedInstallationToken?.cacheKey === cacheKey &&
    cachedInstallationToken.expiresAt - APP_TOKEN_CACHE_BUFFER_MS > now
  ) {
    return cachedInstallationToken.token;
  }

  try {
    const next = await createGitHubAppInstallationToken({
      fetchImpl: options.fetchImpl,
      userAgent: options.userAgent,
      now,
    });
    cachedInstallationToken = { ...next, cacheKey };
    return next.token;
  } catch (error) {
    console.warn(`[githubAuth] GitHub App token unavailable: ${errorMessage(error)}`);
    return null;
  }
}

function readGitHubAppConfig(env: NodeJS.ProcessEnv): GitHubAppConfig | null {
  const appId = env.GITHUB_APP_ID?.trim();
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !installationId || !privateKey) return null;
  return { appId, installationId, privateKey };
}

async function createGitHubAppJwt(appId: string, rawPrivateKey: string, nowMs: number) {
  const now = Math.floor(nowMs / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const signingInput = `${base64UrlString(JSON.stringify(header))}.${base64UrlString(
    JSON.stringify(payload),
  )}`;
  const key = await importPrivateKey(rawPrivateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}

async function importPrivateKey(rawPrivateKey: string) {
  const { label, der } = parsePem(rawPrivateKey);
  const pkcs8 = label === "RSA PRIVATE KEY" ? wrapPkcs1PrivateKeyAsPkcs8(der) : der;
  return await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function parsePem(raw: string) {
  const normalized = raw.replace(/\\n/g, "\n").trim();
  const match = /^-----BEGIN ([A-Z0-9 ]+)-----\s*([A-Za-z0-9+/=\s]+)\s*-----END \1-----$/m.exec(
    normalized,
  );
  if (!match) throw new Error("Invalid GitHub App private key");
  const label = match[1];
  if (label !== "PRIVATE KEY" && label !== "RSA PRIVATE KEY") {
    throw new Error(`Unsupported GitHub App private key type: ${label}`);
  }
  return { label, der: base64ToBytes(match[2]) };
}

function wrapPkcs1PrivateKeyAsPkcs8(pkcs1: Uint8Array) {
  const version = derInteger(0);
  const rsaEncryptionAlgorithm = derSequence(
    new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]),
    new Uint8Array([0x05, 0x00]),
  );
  return derSequence(version, rsaEncryptionAlgorithm, derOctetString(pkcs1));
}

function derSequence(...parts: Uint8Array[]) {
  return derTagged(0x30, concatBytes(parts));
}

function derInteger(value: number) {
  return derTagged(0x02, new Uint8Array([value]));
}

function derOctetString(value: Uint8Array) {
  return derTagged(0x04, value);
}

function derTagged(tag: number, value: Uint8Array) {
  return concatBytes([new Uint8Array([tag]), derLength(value.length), value]);
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
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function base64UrlString(value: string) {
  return base64UrlBytes(new TextEncoder().encode(value));
}

function base64UrlBytes(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hashCacheKey(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
