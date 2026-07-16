import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { fail } from "../../../clawhub/src/cli/ui.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import { ApiRoutes } from "../../../clawhub/src/schema/index.js";

type FeaturedOptions = {
  json?: boolean;
};

type FeaturedPackageResult = {
  ok: true;
  featured: boolean;
  packageId: string;
  name: string;
};

type FeaturedSkillResult = {
  ok: true;
  featured: boolean;
  skillId: string;
  slug: string;
  ownerHandle: string | null;
};

type SkillRef = {
  slug: string;
  ownerHandle?: string;
};

function normalizePackageNameOrFail(value: string) {
  const name = value.trim();
  if (!name) fail("Package name required");
  return name;
}

function parseSkillRefOrFail(value: string): SkillRef {
  const ref = value.trim();
  if (!ref) fail("Skill ref required");

  const slashIndex = ref.indexOf("/");
  if (slashIndex < 0) {
    if (ref.includes("\\") || ref.includes("..")) fail(`Invalid skill ref: ${value}`);
    return { slug: ref.toLowerCase() };
  }
  if (ref.indexOf("/", slashIndex + 1) >= 0) fail(`Invalid skill ref: ${value}`);

  const ownerHandle = ref.slice(0, slashIndex).trim().replace(/^@+/, "").toLowerCase();
  const slug = ref
    .slice(slashIndex + 1)
    .trim()
    .toLowerCase();
  if (
    !ownerHandle ||
    !slug ||
    ownerHandle.includes("\\") ||
    ownerHandle.includes("..") ||
    slug.includes("\\") ||
    slug.includes("..")
  ) {
    fail(`Invalid skill ref: ${value}`);
  }
  return { slug, ownerHandle };
}

export async function cmdSetPackageFeatured(
  opts: GlobalOpts,
  packageName: string,
  featured: boolean,
  options: FeaturedOptions = {},
) {
  const name = normalizePackageNameOrFail(packageName);
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest<FeaturedPackageResult>(registry, {
    method: "POST",
    path: `${ApiRoutes.packages}/${encodeURIComponent(name)}/featured`,
    token,
    body: { featured },
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  console.log(`OK. ${featured ? "Featured" : "Unfeatured"} plugin ${result.name}.`);
  return result;
}

export async function cmdSetSkillFeatured(
  opts: GlobalOpts,
  skillRef: string,
  featured: boolean,
  options: FeaturedOptions = {},
) {
  const ref = parseSkillRefOrFail(skillRef);
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest<FeaturedSkillResult>(registry, {
    method: "POST",
    path: `${ApiRoutes.skills}/${encodeURIComponent(ref.slug)}/featured`,
    token,
    body: {
      featured,
      ...(ref.ownerHandle ? { ownerHandle: ref.ownerHandle } : {}),
    },
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  const label = result.ownerHandle ? `@${result.ownerHandle}/${result.slug}` : result.slug;
  console.log(`OK. ${featured ? "Featured" : "Unfeatured"} skill ${label}.`);
  return result;
}
