import { getRuntimeEnv } from "./runtimeEnv";

const DEFAULT_CLAWHUB_SITE_URL = "https://clawhub.ai";
const LEGACY_CLAWDHUB_HOSTS = new Set(["clawdhub.com", "www.clawdhub.com", "auth.clawdhub.com"]);

export const SITE_NAME = "ClawHub";
export const SITE_DESCRIPTION = "ClawHub — a fast skill registry for agents, with vector search.";

export function normalizeClawHubSiteOrigin(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (LEGACY_CLAWDHUB_HOSTS.has(url.hostname.toLowerCase())) {
      return DEFAULT_CLAWHUB_SITE_URL;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function getClawHubSiteUrl() {
  return normalizeClawHubSiteOrigin(getRuntimeEnv("VITE_SITE_URL")) ?? DEFAULT_CLAWHUB_SITE_URL;
}
