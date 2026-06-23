export const CLAWHUB_SITE_URL = "https://clawhub.ai";
export const CLAWHUB_REPOSITORY_URL = "https://github.com/openclaw/clawhub";
export const CLAWHUB_DOCS_URL = "https://docs.openclaw.ai/clawhub/";
export const OPENCLAW_DOCS_LLMS_URL = "https://docs.openclaw.ai/llms.txt";
export const CLAWHUB_OPENAPI_URL = `${CLAWHUB_SITE_URL}/api/v1/openapi.json`;

export const PublicRegistryPaths = {
  home: "/",
  skills: "/skills",
  plugins: "/plugins",
  publishers: "/publishers",
  search: "/search",
  audits: "/audits",
  publishSkill: "/skills/publish",
  publishPlugin: "/plugins/publish",
} as const;

export const PUBLIC_REGISTRY_SURFACES = [
  {
    label: "Skills",
    path: PublicRegistryPaths.skills,
    summary: "Browse and search skill bundles centered on SKILL.md.",
  },
  {
    label: "Plugins and packages",
    path: PublicRegistryPaths.plugins,
    summary: "Browse and search OpenClaw plugin package records.",
  },
  {
    label: "Publishers",
    path: PublicRegistryPaths.publishers,
    summary: "Browse public user and organization publishers.",
  },
  {
    label: "Search",
    path: PublicRegistryPaths.search,
    summary: "Search the public ClawHub catalog.",
  },
  {
    label: "Security audits",
    path: PublicRegistryPaths.audits,
    summary: "Browse public artifact security audit results.",
  },
  {
    label: "Publish a skill",
    path: PublicRegistryPaths.publishSkill,
    summary: "Publish a new skill or update an existing skill.",
  },
  {
    label: "Publish a plugin",
    path: PublicRegistryPaths.publishPlugin,
    summary: "Publish an OpenClaw plugin package.",
  },
] as const;

export function publicRegistryUrl(path: string) {
  return new URL(path, CLAWHUB_SITE_URL).href;
}

export function clawhubDocsUrl(slug?: string) {
  return new URL(slug ?? "", CLAWHUB_DOCS_URL).href;
}
