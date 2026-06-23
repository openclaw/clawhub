import { buildSkillDetailHref, buildPublisherProfileHref } from "./ownerRoute";
import { buildPluginDetailHref } from "./pluginRoutes";
import { getRuntimeEnv } from "./runtimeEnv";
import { getClawHubSiteUrl, SITE_DESCRIPTION } from "./site";

type SkillMetaSource = {
  slug: string;
  owner?: string | null;
  ownerId?: string | null;
  displayName?: string | null;
  summary?: string | null;
  version?: string | null;
};

type SkillMeta = {
  title: string;
  description: string;
  image: string;
  url: string;
  owner: string | null;
};

type PluginMetaSource = {
  name: string;
  displayName?: string | null;
  summary?: string | null;
  owner?: string | null;
  latestVersion?: string | null;
};

type PublisherMetaSource = {
  handle: string;
  displayName?: string | null;
  bio?: string | null;
};

type BasicMeta = {
  title: string;
  description: string;
  image: string;
  url: string;
};

const OG_SKILL_IMAGE_LAYOUT_VERSION = "8";
const OG_PLUGIN_IMAGE_LAYOUT_VERSION = "3";
const OG_PUBLISHER_IMAGE_LAYOUT_VERSION = "3";

function getSiteUrl() {
  return getClawHubSiteUrl();
}

function getApiBase() {
  const explicit = getRuntimeEnv("VITE_CONVEX_SITE_URL");
  return explicit || getSiteUrl();
}

export async function fetchSkillMeta(slug: string) {
  try {
    const apiBase = getApiBase();
    const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, apiBase);
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      skill?: { displayName?: string; summary?: string | null } | null;
      owner?: { handle?: string | null; userId?: string | null } | null;
      latestVersion?: { version?: string | null } | null;
    };
    return {
      displayName: payload.skill?.displayName ?? null,
      summary: payload.skill?.summary ?? null,
      owner: payload.owner?.handle ?? null,
      ownerId: payload.owner?.userId ?? null,
      version: payload.latestVersion?.version ?? null,
    };
  } catch {
    return null;
  }
}

export function buildSkillMeta(source: SkillMetaSource): SkillMeta {
  const siteUrl = getSiteUrl();
  const owner = clean(source.owner);
  const ownerId = clean(source.ownerId);
  const displayName = clean(source.displayName) || clean(source.slug);
  const summary = clean(source.summary);
  const version = clean(source.version);
  const title = `${displayName} — ClawHub`;
  const description =
    summary || (owner ? `Agent skill by @${owner} on ClawHub.` : SITE_DESCRIPTION);
  const ownerPath = owner || ownerId || "unknown";
  const url = `${siteUrl}${buildSkillDetailHref(ownerPath, source.slug)}`;
  const imageParams = new URLSearchParams();
  imageParams.set("v", OG_SKILL_IMAGE_LAYOUT_VERSION);
  imageParams.set("slug", source.slug);
  if (owner) imageParams.set("owner", owner);
  if (version) imageParams.set("version", version);
  return {
    title,
    description: truncate(description, 200),
    image: `${siteUrl}/og/skill?${imageParams.toString()}`,
    url,
    owner: owner || null,
  };
}

export function buildPluginMeta(source: PluginMetaSource): BasicMeta {
  const siteUrl = getSiteUrl();
  const displayName = clean(source.displayName) || clean(source.name);
  const summary = clean(source.summary);
  const owner = clean(source.owner);
  const latestVersion = clean(source.latestVersion);
  const title = `${displayName} — ClawHub Plugins`;
  const description = summary || (owner ? `Plugin by @${owner} on ClawHub.` : SITE_DESCRIPTION);
  const url = `${siteUrl}${buildPluginDetailHref(source.name, { ownerHandle: owner })}`;
  const imageParams = new URLSearchParams();
  imageParams.set("v", OG_PLUGIN_IMAGE_LAYOUT_VERSION);
  imageParams.set("name", source.name);
  if (latestVersion) imageParams.set("version", latestVersion);
  return {
    title,
    description: truncate(description, 200),
    image: `${siteUrl}/og/plugin?${imageParams.toString()}`,
    url,
  };
}

export function buildPublisherMeta(source: PublisherMetaSource): BasicMeta {
  const siteUrl = getSiteUrl();
  const handle = clean(source.handle).replace(/^@+/, "");
  const displayName = clean(source.displayName) || `@${handle}`;
  const bio = clean(source.bio);
  const title = `${displayName} — ClawHub`;
  const description = bio || `Publisher @${handle} on ClawHub.`;
  const imageParams = new URLSearchParams();
  imageParams.set("v", OG_PUBLISHER_IMAGE_LAYOUT_VERSION);
  imageParams.set("handle", handle);
  return {
    title,
    description: truncate(description, 200),
    image: `${siteUrl}/og/profile?${imageParams.toString()}`,
    url: `${siteUrl}${buildPublisherProfileHref(handle)}`,
  };
}

function clean(value?: string | null) {
  return value?.trim() ?? "";
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}
