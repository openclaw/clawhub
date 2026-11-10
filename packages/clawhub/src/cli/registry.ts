import { readGlobalConfig, writeGlobalConfig } from "../config.js";
import { discoverRegistryFromSite } from "../discovery.js";
import type { GlobalOpts } from "./types.js";

export const DEFAULT_SITE = "https://clawhub.ai";
export const DEFAULT_REGISTRY = "https://clawhub.ai";
const LEGACY_REGISTRY_HOSTS = new Set([
  "auth.clawdhub.com",
  "auth.clawhub.com",
  "auth.clawhub.ai",
  "registry.clawhub.ai",
]);

export async function resolveRegistry(opts: GlobalOpts) {
  const explicit = opts.registrySource !== "default" ? opts.registry.trim() : "";
  if (explicit) return explicit;

  const discovery = await discoverRegistryFromSite(opts.site).catch(() => null);
  const discovered = discovery?.apiBase?.trim();
  if (discovered) return discovered;

  const cfg = await readGlobalConfig();
  const cached = cfg?.registry?.trim();
  if (cached && !isLegacyRegistry(cached)) return cached;
  return DEFAULT_REGISTRY;
}

export async function getRegistry(opts: GlobalOpts, params?: { cache?: boolean }) {
  const cache = params?.cache !== false;
  const registry = await resolveRegistry(opts);
  if (!cache) return registry;
  const cfg = await readGlobalConfig();
  const cached = cfg?.registry?.trim();
  const shouldUpdate =
    !cached ||
    isLegacyRegistry(cached) ||
    (cached === DEFAULT_REGISTRY && registry !== DEFAULT_REGISTRY);
  if (!shouldUpdate) return registry;

  const token = tokenForRegistry(cached, registry, cfg?.token);
  const explicit = opts.registrySource !== "default";
  // A discovered registry must not replace a saved login, and it must not
  // keep that login's token. An explicit --registry or env registry may
  // switch the saved registry, without carrying the old token across origins.
  if (token || !cfg?.token || explicit || isLegacyRegistry(cached ?? "")) {
    await writeGlobalConfig({ registry, token });
  }
  return registry;
}

export function registryOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function tokenForRegistry(
  savedRegistry: string | undefined,
  targetRegistry: string,
  token: string | undefined,
) {
  if (!token) return undefined;
  const target = registryOrigin(targetRegistry);
  const saved = registryOrigin(savedRegistry);
  if (target && saved && target === saved) return token;
  if (
    savedRegistry &&
    isLegacyRegistry(savedRegistry) &&
    target === registryOrigin(DEFAULT_REGISTRY)
  ) {
    return token;
  }
  return undefined;
}

function isLegacyRegistry(registry: string) {
  try {
    return LEGACY_REGISTRY_HOSTS.has(new URL(registry).hostname);
  } catch {
    return false;
  }
}
