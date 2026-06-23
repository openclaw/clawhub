import { CLAWHUB_DOCS_URL, CLAWHUB_REPOSITORY_URL, PublicRegistryPaths } from "./publicRegistry";

/**
 * Shared navigation configuration used by Header and Footer to eliminate
 * triple duplication of nav link definitions.
 */

interface NavItemBase {
  /** Visible link text */
  label: string;
  /** Additional path prefixes that should also highlight this nav item (e.g. /skill for /skills) */
  activePathPrefixes?: string[];
}

interface RouteNavItem extends NavItemBase {
  /** Route path passed to `<Link to>` */
  to: string;
  href?: never;
  /** Optional search params object passed to `<Link search>` */
  search?: Record<string, unknown>;
}

interface ExternalNavItem extends NavItemBase {
  /** URL rendered as a normal anchor, including external and static app paths. */
  href: string;
  to?: never;
  search?: never;
}

type NavItem = RouteNavItem | ExternalNavItem;

// ---------------------------------------------------------------------------
// Search-param shapes (kept here so Header, Footer, and mobile menu all agree)
// ---------------------------------------------------------------------------

const SKILLS_SEARCH = {
  q: undefined,
  sort: undefined,
  dir: undefined,
  highlighted: undefined,
  view: undefined,
  focus: undefined,
} as const;

// ---------------------------------------------------------------------------
// Primary nav items (desktop tabs row + mobile dropdown top section)
// These map to the content-type tabs: Skills | Plugins | Publishers
// ---------------------------------------------------------------------------

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  {
    label: "Skills",
    to: PublicRegistryPaths.skills,
    search: SKILLS_SEARCH,
    activePathPrefixes: ["/skill/"],
  },
  {
    label: "Plugins",
    to: PublicRegistryPaths.plugins,
    activePathPrefixes: ["/plugin/"],
  },
  {
    label: "Publishers",
    to: PublicRegistryPaths.publishers,
  },
];

// ---------------------------------------------------------------------------
// Secondary nav items (desktop secondary tabs + mobile dropdown section)
// ---------------------------------------------------------------------------

export const SECONDARY_NAV_ITEMS: NavItem[] = [
  {
    label: "Docs",
    href: CLAWHUB_DOCS_URL,
    activePathPrefixes: ["/docs"],
  },
];

// ---------------------------------------------------------------------------
// Footer sections
// ---------------------------------------------------------------------------

export const OPENCLAW_SITE_URL = "https://openclaw.ai";
export const OPENCLAW_ECOSYSTEM_URL = `${OPENCLAW_SITE_URL}/ecosystem`;
const OPENCLAW_BLOG_CLAWHUB_URL = `${OPENCLAW_SITE_URL}/blog#clawhub`;
export const OPENCLAW_CLAWHUB_DOCS_URL = CLAWHUB_DOCS_URL;
/** Compact mark for stack avatars (not the full wordmark). */
export const OPENCLAW_LOGO_URL = `${OPENCLAW_SITE_URL}/favicon.svg`;

interface FooterNavSection {
  title: string;
  items: FooterNavItem[];
}

type FooterNavItem =
  | {
      kind: "link";
      label: string;
      to: string;
      search?: Record<string, unknown>;
      featureFlag?: boolean;
    }
  | {
      kind: "external";
      label: string;
      href: string;
      icon?: "github" | "discord";
      featureFlag?: boolean;
    }
  | { kind: "text"; label: string; featureFlag?: boolean };

export const FOOTER_NAV_SECTIONS: FooterNavSection[] = [
  {
    title: "Browse",
    items: [
      { kind: "link", label: "Skills", to: PublicRegistryPaths.skills, search: SKILLS_SEARCH },
      { kind: "link", label: "Plugins", to: PublicRegistryPaths.plugins },
      { kind: "link", label: "Publishers", to: PublicRegistryPaths.publishers },
      {
        kind: "link",
        label: "Audits",
        to: PublicRegistryPaths.audits,
        search: { type: undefined },
      },
    ],
  },
  {
    title: "Publish",
    items: [
      {
        kind: "link",
        label: "Publish Skill",
        to: PublicRegistryPaths.publishSkill,
        search: { updateSlug: undefined },
      },
      {
        kind: "link",
        label: "Publish Plugin",
        to: PublicRegistryPaths.publishPlugin,
        search: {
          ownerHandle: undefined,
          name: undefined,
          displayName: undefined,
          family: undefined,
          nextVersion: undefined,
          sourceRepo: undefined,
        },
      },
      {
        kind: "link",
        label: "Create org",
        to: "/settings",
        search: { view: "organizations" },
      },
    ],
  },
  {
    title: "Ecosystem",
    items: [
      { kind: "external", label: "Overview", href: OPENCLAW_ECOSYSTEM_URL },
      { kind: "external", label: "OpenClaw", href: OPENCLAW_SITE_URL },
      { kind: "external", label: "Docs", href: "https://docs.openclaw.ai/" },
      { kind: "external", label: "Blog", href: OPENCLAW_BLOG_CLAWHUB_URL },
    ],
  },
  {
    title: "Community",
    items: [
      {
        kind: "external",
        label: "GitHub",
        href: CLAWHUB_REPOSITORY_URL,
        icon: "github",
      },
      {
        kind: "external",
        label: "Discord",
        href: "https://discord.gg/clawd",
        icon: "discord",
      },
    ],
  },
];

export const FOOTER_PLATFORM_LINKS = [
  { label: "Deployed on Vercel", href: "https://vercel.com" },
  { label: "Powered by Convex", href: "https://www.convex.dev" },
] as const;

export type FooterEcosystemProject = {
  label: string;
  href: string;
  blurb: string;
  /** Logo URL from https://openclaw.ai/ecosystem assets. */
  logoUrl: string;
  internal?: boolean;
};

/** Build a URL for logos/banners published on the OpenClaw ecosystem page. */
function openclawEcosystemAsset(path: string) {
  return `${OPENCLAW_SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Curated highlights from https://openclaw.ai/ecosystem */
export const FOOTER_ECOSYSTEM_PROJECTS: FooterEcosystemProject[] = [
  {
    label: "ClawHub",
    href: "/",
    blurb: "Skills & plugins",
    logoUrl: openclawEcosystemAsset("/ecosystem/logos/clawhub.png"),
    internal: true,
  },
  {
    label: "Lobster",
    href: "https://docs.openclaw.ai/tools/lobster",
    blurb: "Workflow shell",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/lobster.png"),
  },
  {
    label: "Crabbox",
    href: "https://crabbox.sh",
    blurb: "Agent sandboxes",
    logoUrl: openclawEcosystemAsset("/ecosystem/logos/crabbox.svg"),
  },
  {
    label: "ClickClack",
    href: "https://clickclack.chat",
    blurb: "Chat for claws",
    logoUrl: openclawEcosystemAsset("/ecosystem/logos/clickclack.svg"),
  },
  {
    label: "Crabfleet",
    href: "https://crabfleet.ai",
    blurb: "Fleet control",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/crabfleet.png"),
  },
  {
    label: "Octopool",
    href: "https://octopool.dev",
    blurb: "GitHub relay",
    logoUrl: openclawEcosystemAsset("/ecosystem/logos/octopool.svg"),
  },
  {
    label: "ClawSweeper",
    href: "https://clawsweeper.bot",
    blurb: "Issue triage",
    logoUrl: openclawEcosystemAsset("/ecosystem/logos/clawsweeper.svg"),
  },
  {
    label: "agent-skills",
    href: "https://github.com/openclaw/agent-skills",
    blurb: "Shared skills",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/agent-skills.png"),
  },
  {
    label: "discrawl",
    href: "https://github.com/openclaw/discrawl",
    blurb: "Discord archive",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/discrawl.png"),
  },
  {
    label: "gitcrawl",
    href: "https://github.com/openclaw/gitcrawl",
    blurb: "GitHub crawler",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/gitcrawl.png"),
  },
  {
    label: "slacrawl",
    href: "https://github.com/openclaw/slacrawl",
    blurb: "Slack archive",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/slacrawl.png"),
  },
  {
    label: "notcrawl",
    href: "https://github.com/openclaw/notcrawl",
    blurb: "Notion archive",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/notcrawl.png"),
  },
  {
    label: "telecrawl",
    href: "https://github.com/openclaw/telecrawl",
    blurb: "Telegram archive",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/telecrawl.png"),
  },
  {
    label: "graincrawl",
    href: "https://github.com/openclaw/graincrawl",
    blurb: "Granola notes",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/graincrawl.png"),
  },
  {
    label: "crawlkit",
    href: "https://github.com/openclaw/crawlkit",
    blurb: "Crawler toolkit",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/crawlkit.png"),
  },
  {
    label: "crawlbar",
    href: "https://github.com/openclaw/crawlbar",
    blurb: "Crawl menu bar",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/crawlbar.png"),
  },
  {
    label: "acpx",
    href: "https://github.com/openclaw/acpx",
    blurb: "ACP sessions",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/acpx.png"),
  },
  {
    label: "mcporter",
    href: "https://github.com/openclaw/mcporter",
    blurb: "MCP tooling",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/mcporter.png"),
  },
  {
    label: "Tachikoma",
    href: "https://github.com/openclaw/Tachikoma",
    blurb: "Swift model SDK",
    logoUrl: openclawEcosystemAsset("/ecosystem/logos/tachikoma.png"),
  },
  {
    label: "clawpatch",
    href: "https://github.com/openclaw/clawpatch",
    blurb: "Review & patch",
    logoUrl: openclawEcosystemAsset("/ecosystem/logos/clawpatch.svg"),
  },
  {
    label: "clawbench",
    href: "https://github.com/openclaw/clawbench",
    blurb: "Agent benchmark",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/clawbench.png"),
  },
  {
    label: "Peekaboo",
    href: "https://github.com/openclaw/Peekaboo",
    blurb: "macOS capture",
    logoUrl: openclawEcosystemAsset("/ecosystem/logos/peekaboo.png"),
  },
  {
    label: "cookbook",
    href: "https://github.com/openclaw/cookbook",
    blurb: "SDK examples",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/cookbook.png"),
  },
  {
    label: "plugin-inspector",
    href: "https://github.com/openclaw/plugin-inspector",
    blurb: "Plugin testing",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/plugin-inspector.png"),
  },
  {
    label: "wacrawl",
    href: `${OPENCLAW_ECOSYSTEM_URL}#wacrawl`,
    blurb: "WhatsApp archive",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/wacrawl.png"),
  },
  {
    label: "crabpot",
    href: "https://github.com/openclaw/crabpot",
    blurb: "Plugin testbed",
    logoUrl: openclawEcosystemAsset("/ecosystem/banners/crabpot.svg"),
  },
];
