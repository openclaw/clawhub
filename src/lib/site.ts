import { getRuntimeEnv } from "./runtimeEnv";

const DEFAULT_CLAWHUB_SITE_URL = "https://clawhub.ai";
const LEGACY_CLAWDHUB_HOSTS = new Set(["clawdhub.com", "www.clawdhub.com", "auth.clawdhub.com"]);
const LOCAL_SITE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

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

export function getPublicClawHubSiteUrl() {
  const configured = getClawHubSiteUrl();
  try {
    return LOCAL_SITE_HOSTS.has(new URL(configured).hostname)
      ? DEFAULT_CLAWHUB_SITE_URL
      : configured;
  } catch {
    return DEFAULT_CLAWHUB_SITE_URL;
  }
}
