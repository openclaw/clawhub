import { buildDeterministicPackageZip } from "./skillZip";

export const STOREPACK_SPEC_VERSION = 1;
export const STOREPACK_BUILD_VERSION = "clawhub-storepack-v1";
export const STOREPACK_MANIFEST_PATH = "STOREPACK.json";

export type StorePackHostTarget = {
  os: "darwin" | "linux" | "win32";
  arch: "arm64" | "x64";
  libc?: "glibc" | "musl";
  nodeRange?: string;
  openclawRange?: string;
  pluginApiRange?: string;
  supportState?: "supported" | "setup-required" | "unsupported";
  unsupportedReason?: string;
};

export type StorePackEnvironmentSummary = {
  requiresLocalDesktop?: boolean;
  requiresBrowser?: boolean;
  requiresAudioDevice?: boolean;
  requiresNetwork?: boolean;
  requiresExternalServices?: string[];
  requiresOsPermissions?: string[];
  supportsRemoteHost?: boolean;
  knownUnsupported?: string[];
};

export type StorePackFile = {
  path: string;
  size: number;
  sha256: string;
  bytes: Uint8Array;
  contentType?: string;
};

export type StorePackInput = {
  packageId: string;
  releaseId: string;
  name: string;
  owner?: string | null;
  slug: string;
  version: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  channel: "official" | "community" | "private";
  publishedAt: number;
  source?: unknown;
  compatibility?: unknown;
  capabilities?: unknown;
  verification?: unknown;
  files: StorePackFile[];
};

export type BuiltStorePack = {
  bytes: Uint8Array;
  sha256: string;
  size: number;
  fileCount: number;
  manifestSha256: string;
  manifest: Record<string, unknown>;
  hostTargets: StorePackHostTarget[];
  environment: StorePackEnvironmentSummary;
};

const textEncoder = new TextEncoder();

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function stableJson(value: unknown) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function normalizeHostTarget(raw: string): StorePackHostTarget | null {
  const parts = raw
    .trim()
    .toLowerCase()
    .split(/[-_/]/)
    .filter(Boolean);
  const os = parts.find((part) => part === "darwin" || part === "linux" || part === "win32");
  const arch = parts.find((part) => part === "arm64" || part === "x64");
  const libc = parts.find((part) => part === "glibc" || part === "musl");
  if (!os || !arch) return null;
  return {
    os,
    arch,
    ...(libc ? { libc } : {}),
    supportState: "supported",
  };
}

function uniqueTargets(targets: StorePackHostTarget[]) {
  const seen = new Set<string>();
  const result: StorePackHostTarget[] = [];
  for (const target of targets) {
    const key = [target.os, target.arch, target.libc ?? ""].join("-");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

export function deriveStorePackHostTargets(input: {
  capabilities?: unknown;
  compatibility?: unknown;
}): StorePackHostTarget[] {
  const capabilities = asRecord(input.capabilities);
  const compatibility = asRecord(input.compatibility);
  const targetStrings = stringArray(capabilities.hostTargets);
  const fromCapabilities = targetStrings
    .map(normalizeHostTarget)
    .filter((target): target is StorePackHostTarget => Boolean(target));
  if (fromCapabilities.length > 0) {
    return uniqueTargets(
      fromCapabilities.map((target) => ({
        ...target,
        openclawRange: stringValue(compatibility.minGatewayVersion),
        pluginApiRange: stringValue(compatibility.pluginApiRange),
      })),
    );
  }
  return [
    {
      os: "darwin",
      arch: "arm64",
      supportState: "supported",
      openclawRange: stringValue(compatibility.minGatewayVersion),
      pluginApiRange: stringValue(compatibility.pluginApiRange),
    },
    {
      os: "linux",
      arch: "x64",
      libc: "glibc",
      supportState: "supported",
      openclawRange: stringValue(compatibility.minGatewayVersion),
      pluginApiRange: stringValue(compatibility.pluginApiRange),
    },
    {
      os: "win32",
      arch: "x64",
      supportState: "supported",
      openclawRange: stringValue(compatibility.minGatewayVersion),
      pluginApiRange: stringValue(compatibility.pluginApiRange),
    },
  ];
}

export function deriveStorePackEnvironment(input: {
  capabilities?: unknown;
  files: Array<{ path: string }>;
}): StorePackEnvironmentSummary {
  const capabilities = asRecord(input.capabilities);
  const capabilityTags = stringArray(capabilities.capabilityTags).map((tag) => tag.toLowerCase());
  const fileNames = input.files.map((file) => file.path.toLowerCase());
  const requiresBrowser =
    capabilityTags.some((tag) => tag.includes("browser") || tag.includes("playwright")) ||
    fileNames.some((path) => path.includes("playwright") || path.includes("browser"));
  const requiresLocalDesktop = capabilityTags.some(
    (tag) => tag.includes("desktop") || tag.includes("imessage") || tag.includes("bluebubbles"),
  );
  const requiresAudioDevice = capabilityTags.some(
    (tag) => tag.includes("audio") || tag.includes("meet"),
  );
  const externalServices = capabilityTags
    .filter((tag) => tag.startsWith("service:"))
    .map((tag) => tag.slice("service:".length))
    .filter(Boolean);
  return {
    requiresNetwork: true,
    ...(requiresBrowser ? { requiresBrowser } : {}),
    ...(requiresLocalDesktop ? { requiresLocalDesktop } : {}),
    ...(requiresAudioDevice ? { requiresAudioDevice } : {}),
    ...(externalServices.length > 0 ? { requiresExternalServices: externalServices } : {}),
  };
}

export async function buildStorePack(input: StorePackInput): Promise<BuiltStorePack> {
  const publishFiles = input.files.filter(
    (file) => file.path.trim().toLowerCase() !== STOREPACK_MANIFEST_PATH.toLowerCase(),
  );
  const hostTargets = deriveStorePackHostTargets({
    capabilities: input.capabilities,
    compatibility: input.compatibility,
  });
  const environment = deriveStorePackEnvironment({
    capabilities: input.capabilities,
    files: publishFiles,
  });
  const fileManifest = publishFiles
    .map((file) => ({
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      ...(file.contentType ? { contentType: file.contentType } : {}),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const manifest: Record<string, unknown> = {
    specVersion: STOREPACK_SPEC_VERSION,
    kind: "openclaw.storepack",
    package: {
      name: input.name,
      owner: input.owner ?? null,
      slug: input.slug,
      version: input.version,
      family: input.family,
      channel: input.channel,
    },
    release: {
      packageId: input.packageId,
      releaseId: input.releaseId,
      publishedAt: input.publishedAt,
      ...(input.source !== undefined ? { source: input.source } : {}),
    },
    artifact: {
      format: "zip",
      root: "package/",
      specVersion: STOREPACK_SPEC_VERSION,
      contentSha256: await sha256Hex(
        textEncoder.encode(
          stableJson(fileManifest.map((file) => ({ path: file.path, sha256: file.sha256 }))),
        ),
      ),
      fileCount: publishFiles.length,
    },
    files: fileManifest,
    compatibility: input.compatibility ?? null,
    capabilities: input.capabilities ?? null,
    verification: input.verification ?? null,
    hostTargets,
    environment,
    runtimeBundles: [],
  };
  const manifestBytes = textEncoder.encode(stableJson(manifest));
  const manifestSha256 = await sha256Hex(manifestBytes);
  const bytes = buildDeterministicPackageZip([
    { path: STOREPACK_MANIFEST_PATH, bytes: manifestBytes },
    ...publishFiles.map((file) => ({ path: file.path, bytes: file.bytes })),
  ]);
  const sha256 = await sha256Hex(bytes);
  return {
    bytes,
    sha256,
    size: bytes.byteLength,
    fileCount: publishFiles.length + 1,
    manifestSha256,
    manifest,
    hostTargets,
    environment,
  };
}
