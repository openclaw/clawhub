/**
 * Shared navigation configuration used by Header and Footer to eliminate
 * triple duplication of nav link definitions.
 */

/** Lucide icon name used as a key to look up the component at render time. */
type NavIconName = "wrench" | "plug" | "user";

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
  /** Optional lucide icon name shown beside the label in navbar tabs */
  icon?: NavIconName;
}

interface ExternalNavItem extends NavItemBase {
  /** External URL rendered as a normal anchor */
  href: string;
  to?: never;
  search?: never;
  icon?: never;
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

const PUBLISHERS_SEARCH = { q: undefined } as const;

// ---------------------------------------------------------------------------
// Primary nav items (desktop tabs row + mobile dropdown top section)
// These map to the content-type tabs: Skills | Plugins | Publishers
// ---------------------------------------------------------------------------

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  {
    label: "Skills",
    to: "/skills",
    search: SKILLS_SEARCH,
    icon: "wrench",
    activePathPrefixes: ["/skill/"],
  },
  {
    label: "Plugins",
    to: "/plugins",
    icon: "plug",
    activePathPrefixes: ["/plugin/"],
  },
  {
    label: "Publishers",
    to: "/publishers",
    search: PUBLISHERS_SEARCH,
    icon: "user",
  },
];

// ---------------------------------------------------------------------------
// Secondary nav items (desktop secondary tabs + mobile dropdown section)
// ---------------------------------------------------------------------------

export const SECONDARY_NAV_ITEMS: NavItem[] = [
  {
    label: "Docs",
    href: "https://docs.openclaw.ai/clawhub/",
  },
];

// ---------------------------------------------------------------------------
// Footer sections
// ---------------------------------------------------------------------------

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
    }
  | { kind: "external"; label: string; href: string };

export const FOOTER_NAV_SECTIONS: FooterNavSection[] = [
  {
    title: "Browse",
    items: [
      { kind: "link", label: "Skills", to: "/skills", search: SKILLS_SEARCH },
      { kind: "link", label: "Plugins", to: "/plugins" },
      { kind: "link", label: "Audits", to: "/audits", search: { type: undefined } },
    ],
  },
  {
    title: "Publish",
    items: [
      {
        kind: "link",
        label: "Publish Skill",
        to: "/skills/publish",
        search: { updateSlug: undefined },
      },
      {
        kind: "link",
        label: "Publish Plugin",
        to: "/plugins/publish",
        search: {
          ownerHandle: undefined,
          name: undefined,
          displayName: undefined,
          family: undefined,
          nextVersion: undefined,
          sourceRepo: undefined,
        },
      },
    ],
  },
  {
    title: "Community",
    items: [
      { kind: "external", label: "GitHub", href: "https://github.com/openclaw/clawhub" },
      { kind: "external", label: "OpenClaw", href: "https://openclaw.ai" },
    ],
  },
  {
    title: "Platform",
    items: [
      { kind: "external", label: "Deployed on Vercel", href: "https://vercel.com" },
      { kind: "external", label: "Powered by Convex", href: "https://www.convex.dev" },
    ],
  },
];
