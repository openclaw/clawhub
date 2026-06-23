import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { getOpenClawExtensionPackageName } from "./openClawExtensionSlugs";
import { buildPluginDetailHref } from "./pluginRoutes";
import type { PublicPublisherListItem } from "./publicUser";
import { fetchSkillPageData } from "./skillPage";

const OPENCLAW_HANDLE = "openclaw";

type SlugRouteTarget =
  | {
      kind: "plugin";
      name: string;
      href: string;
    }
  | {
      kind: "skill";
      owner: string;
      slug: string;
    }
  | {
      kind: "publisher";
      handle: string;
      publisher: PublicPublisherListItem;
    };

type PluginSlugRouteTarget = Extract<SlugRouteTarget, { kind: "plugin" }>;

function normalizeSlug(slug: string) {
  return slug.trim().toLowerCase();
}

function normalizeOwner(owner: string | null) {
  const normalized = owner?.trim().toLowerCase() ?? "";
  return normalized.startsWith("@") ? normalized.slice(1) : normalized;
}

export async function resolveOpenClawPluginSlug(
  slug: string,
  owner: string | null = OPENCLAW_HANDLE,
): Promise<PluginSlugRouteTarget | null> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug || normalizeOwner(owner) !== OPENCLAW_HANDLE) return null;

  const packageName = getOpenClawExtensionPackageName(normalizedSlug);
  if (packageName)
    return { kind: "plugin", name: packageName, href: buildPluginDetailHref(packageName) };

  return null;
}

export async function resolveTopLevelSlugRoute(slug: string): Promise<SlugRouteTarget | null> {
  const plugin = await resolveOpenClawPluginSlug(slug);
  if (plugin) return plugin;

  const publisher = await resolvePublisherHandle(slug);
  if (publisher) {
    return {
      kind: "publisher",
      handle: publisher.handle,
      publisher,
    };
  }

  const data = await fetchSkillPageData(slug);
  const owner = data.initialData?.result?.owner?.handle ?? data.owner;
  const resolvedSlug = data.initialData?.result?.resolvedSlug ?? slug;
  if (!owner || !data.initialData?.result?.skill) return null;

  return {
    kind: "skill",
    owner,
    slug: resolvedSlug,
  };
}

async function resolvePublisherHandle(handle: string) {
  const normalized = normalizeOwner(handle);
  if (!normalized) return null;

  try {
    return (await convexHttp.query(api.publishers.getProfileByHandle, {
      handle: normalized,
    })) as PublicPublisherListItem | null;
  } catch {
    return null;
  }
}
