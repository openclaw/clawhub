export type SiteMode = "skills" | "souls";

import { getRuntimeEnv } from "./runtimeEnv";

const DEFAULT_CLAWHUB_SITE_URL = "https://clawhub.ai";
const DEFAULT_ONLYCRABS_SITE_URL = "https://onlycrabs.ai";
const DEFAULT_KNOT_SITE_URL = "https://openclaw.openknot.ai";
const DEFAULT_ONLYCRABS_HOST = "onlycrabs.ai";
const LEGACY_CLAWDHUB_HOSTS = new Set(["clawdhub.com", "www.clawdhub.com", "auth.clawdhub.com"]);

function readString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeSiteOrigin(value?: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readDocumentData(name: string) {
  if (typeof document === "undefined") return undefined;
  const dataset = document.documentElement.dataset as Record<string, string | undefined>;
  return readString(dataset[name]);
}

function parseBoolean(value?: string | null) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function normalizeClawHubSiteOrigin(value?: string | null) {
  const origin = normalizeSiteOrigin(value);
  if (!origin) return null;
  const url = new URL(origin);
  if (LEGACY_CLAWDHUB_HOSTS.has(url.hostname.toLowerCase())) {
    return DEFAULT_CLAWHUB_SITE_URL;
  }
  return origin;
}

export function getClawHubSiteUrl() {
  if (isKnotEnabled()) return getKnotSiteUrl();
  return normalizeClawHubSiteOrigin(getRuntimeEnv("VITE_SITE_URL")) ?? DEFAULT_CLAWHUB_SITE_URL;
}

export function getOnlyCrabsSiteUrl() {
  const explicit = getRuntimeEnv("VITE_SOULHUB_SITE_URL");
  if (explicit) return explicit;

  const siteUrl = getRuntimeEnv("VITE_SITE_URL");
  if (siteUrl) {
    try {
      const url = new URL(siteUrl);
      if (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "0.0.0.0"
      ) {
        return url.origin;
      }
    } catch {
      // ignore invalid URLs, fall through to default
    }
  }

  return DEFAULT_ONLYCRABS_SITE_URL;
}

export function getOnlyCrabsHost() {
  return getRuntimeEnv("VITE_SOULHUB_HOST") ?? DEFAULT_ONLYCRABS_HOST;
}

export function isKnotEnabled() {
  const datasetValue = readDocumentData("isKnot");
  if (datasetValue !== undefined) return parseBoolean(datasetValue);

  const envValue = getRuntimeEnv("IS_KNOT") ?? getRuntimeEnv("VITE_IS_KNOT");
  return parseBoolean(envValue);
}

export function getKnotSiteUrl() {
  const datasetValue = readDocumentData("knotSiteUrl");
  if (datasetValue !== undefined) return normalizeSiteOrigin(datasetValue) ?? DEFAULT_KNOT_SITE_URL;

  const explicit = getRuntimeEnv("VITE_SITE_URL") ?? getRuntimeEnv("SITE_URL");
  return normalizeSiteOrigin(explicit) ?? DEFAULT_KNOT_SITE_URL;
}

export function detectSiteMode(host?: string | null): SiteMode {
  if (!host) return "skills";
  const onlyCrabsHost = getOnlyCrabsHost().toLowerCase();
  const lower = host.toLowerCase();
  if (lower === onlyCrabsHost || lower.endsWith(`.${onlyCrabsHost}`)) return "souls";
  return "skills";
}

export function detectSiteModeFromUrl(value?: string | null): SiteMode {
  if (!value) return "skills";
  try {
    const host = new URL(value).hostname;
    return detectSiteMode(host);
  } catch {
    return detectSiteMode(value);
  }
}

export function getSiteMode(): SiteMode {
  if (typeof window !== "undefined") {
    return detectSiteMode(window.location.hostname);
  }
  const forced = getRuntimeEnv("VITE_SITE_MODE");
  if (forced === "souls" || forced === "skills") return forced;

  const onlyCrabsSite = getRuntimeEnv("VITE_SOULHUB_SITE_URL");
  if (onlyCrabsSite) return detectSiteModeFromUrl(onlyCrabsSite);

  const siteUrl = getRuntimeEnv("VITE_SITE_URL") ?? process.env.SITE_URL;
  if (siteUrl) return detectSiteModeFromUrl(siteUrl);

  return "skills";
}

export function getSiteName(mode: SiteMode = getSiteMode()) {
  return mode === "souls" ? "SoulHub" : "ClawHub";
}

export function getSiteDescription(mode: SiteMode = getSiteMode()) {
  return mode === "souls"
    ? "SoulHub — the home for SOUL.md bundles and personal system lore."
    : "ClawHub — a fast skill registry for agents, with vector search.";
}

export function getSiteUrlForMode(mode: SiteMode = getSiteMode()) {
  return mode === "souls" ? getOnlyCrabsSiteUrl() : getClawHubSiteUrl();
}
