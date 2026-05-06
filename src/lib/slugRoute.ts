import { getOpenClawExtensionPackageName } from "./openClawExtensionSlugs";
import { buildPluginDetailHref } from "./pluginRoutes";
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
