import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { getOpenClawExtensionPackageName } from "./openClawExtensionSlugs";
import { buildPluginDetailHref } from "./pluginRoutes";
import type { PublicPublisherProfileItem } from "./publicUser";

const OPENCLAW_HANDLE = "openclaw";

type PluginSlugRouteTarget = {
  kind: "plugin";
  name: string;
  href: string;
};

type TopLevelSlugRouteTarget = {
  kind: "publisher";
  handle: string;
  publisher: PublicPublisherProfileItem;
};

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

export async function resolveTopLevelSlugRoute(
  slug: string,
): Promise<TopLevelSlugRouteTarget | null> {
  const publisher = await resolvePublisherHandle(slug);
  if (publisher) {
    return {
      kind: "publisher",
      handle: publisher.handle,
      publisher,
    };
  }

  return null;
}

async function resolvePublisherHandle(handle: string) {
  const normalized = normalizeOwner(handle);
  if (!normalized) return null;

  try {
    return (await convexHttp.query(api.publishers.getProfileByHandle, {
      handle: normalized,
    })) as PublicPublisherProfileItem | null;
  } catch {
    return null;
  }
}
