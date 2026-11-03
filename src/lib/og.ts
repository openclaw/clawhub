import { buildSkillDetailHref, buildPublisherProfileHref } from "./ownerRoute";
import { buildPluginDetailHref } from "./pluginRoutes";
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
  image?: string | null;
  kind?: "user" | "org";
  official: boolean | null;
  affiliations: Array<{
    publisher?: {
      displayName?: string | null;
      image?: string | null;
    } | null;
  }> | null;
  downloads?: number | null;
};

type BasicMeta = {
  title: string;
  description: string;
  image: string;
  url: string;
};

const OG_SKILL_IMAGE_LAYOUT_VERSION = "10";
const OG_PLUGIN_IMAGE_LAYOUT_VERSION = "5";
const OG_PUBLISHER_IMAGE_LAYOUT_VERSION = "8";

function getSiteUrl() {
  return getClawHubSiteUrl();
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
  const image = clean(source.image);
  const title = `${displayName} — ClawHub`;
  const description = bio || `Publisher @${handle} on ClawHub.`;
  const imageParams = new URLSearchParams();
  imageParams.set("v", OG_PUBLISHER_IMAGE_LAYOUT_VERSION);
  imageParams.set("handle", handle);
  imageParams.set("title", displayName);
  if (source.kind === "org") imageParams.set("kind", "org");
  imageParams.set("official", source.official ? "1" : "0");
  const organizationCount = source.affiliations?.length ?? 0;
  imageParams.set("orgState", organizationCount > 1 ? "many" : String(organizationCount));
  const organizationImages =
    source.affiliations
      ?.map((affiliation) => clean(affiliation.publisher?.image))
      .map((imageUrl) => imageUrl.replace(/\|/g, ""))
      .filter(Boolean) ?? [];
  imageParams.set(
    "orgImages",
    organizationImages.length > 0 ? organizationImages.slice(0, 5).join("|") : "0",
  );
  if (image) imageParams.set("avatar", image);
  if (typeof source.downloads === "number" && Number.isFinite(source.downloads)) {
    imageParams.set("downloads", String(Math.max(0, Math.trunc(source.downloads))));
  }
  return {
    title,
    description: truncate(description, 200),
    image: `${siteUrl}/og/profile?${imageParams.toString()}`,
    url: `${siteUrl}${buildPublisherProfileHref(handle)}`,
  };
}

export function buildSocialMetaHead(meta: BasicMeta) {
  return {
    meta: [
      { title: meta.title },
      { name: "description", content: meta.description },
      { property: "og:title", content: meta.title },
      { property: "og:description", content: meta.description },
      { property: "og:url", content: meta.url },
      { property: "og:image", content: meta.image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: meta.title },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: meta.title },
      { name: "twitter:description", content: meta.description },
      { name: "twitter:image", content: meta.image },
    ],
    links: [{ rel: "canonical", href: meta.url }],
  };
}

function clean(value?: string | null) {
  return value?.trim() ?? "";
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}
