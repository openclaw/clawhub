import { FEATURE_SOULS } from "./features";

/**
 * Shared navigation configuration used by Header and Footer to eliminate
 * triple duplication of nav link definitions.
 */

/** Lucide icon name used as a key to look up the component at render time. */
export type NavIconName = "wrench" | "plug" | "ghost";

interface NavItem {
  /** Visible link text */
  label: string;
  /** Route path passed to `<Link to>` */
  to: string;
  /** Optional search params object passed to `<Link search>` */
  search?: Record<string, unknown>;
  /** Optional lucide icon name shown beside the label in navbar tabs */
  icon?: NavIconName;
  /** Link only shown when user is authenticated */
  authRequired: boolean;
  /** Link only shown for staff / moderator users */
  staffOnly: boolean;
  /** Link only shown when siteMode === "souls" */
  soulModeOnly: boolean;
  /** Link hidden when siteMode === "souls" */
  soulModeHide: boolean;
  /** Additional path prefixes that should also highlight this nav item (e.g. /skill for /skills) */
  activePathPrefixes?: string[];
  /** Feature flag that must be truthy for this item to show */
  featureFlag?: boolean;
}

// ---------------------------------------------------------------------------
// Search-param shapes (kept here so Header, Footer, and mobile menu all agree)
// ---------------------------------------------------------------------------

const SKILLS_SEARCH = {
  q: undefined,
  sort: undefined,
  dir: undefined,
  highlighted: undefined,
  nonSuspicious: undefined,
  view: undefined,
  focus: undefined,
} as const;

const SOULS_SEARCH = {
  q: undefined,
  sort: undefined,
  dir: undefined,
  view: undefined,
  focus: undefined,
} as const;

const USERS_SEARCH = { q: undefined } as const;

// ---------------------------------------------------------------------------
// Primary nav items (desktop tabs row + mobile dropdown top section)
// These map to the "content-type" tabs: Skills | Plugins | Souls
// In soul-mode the order is: ClawHub (external), Souls
// In skills-mode: Skills, Plugins, Souls
// ---------------------------------------------------------------------------

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  {
    label: "Skills",
    to: "/skills",
    search: SKILLS_SEARCH,
    icon: "wrench",
    authRequired: false,
    staffOnly: false,
    soulModeOnly: false,
    soulModeHide: true,
    activePathPrefixes: ["/skill/"],
  },
  {
    label: "Plugins",
    to: "/plugins",
    icon: "plug",
    authRequired: false,
    staffOnly: false,
    soulModeOnly: false,
    soulModeHide: false,
    activePathPrefixes: ["/plugin/"],
  },
  {
    label: "Souls",
    to: "/souls",
    search: SOULS_SEARCH,
    icon: "ghost",
    authRequired: false,
    staffOnly: false,
    soulModeOnly: false,
    soulModeHide: false,
    activePathPrefixes: ["/soul/"],
    featureFlag: FEATURE_SOULS,
  },
];

// ---------------------------------------------------------------------------
// Secondary nav items (desktop secondary tabs + mobile dropdown section)
// ---------------------------------------------------------------------------

export const SECONDARY_NAV_ITEMS: NavItem[] = [
  {
    label: "Users",
    to: "/users",
    search: USERS_SEARCH,
    authRequired: false,
    staffOnly: false,
    soulModeOnly: false,
    soulModeHide: true,
  },
  {
    label: "About",
    to: "/about",
    authRequired: false,
    staffOnly: false,
    soulModeOnly: false,
    soulModeHide: true,
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
      featureFlag?: boolean;
    }
  | { kind: "external"; label: string; href: string; featureFlag?: boolean }
  | { kind: "text"; label: string; featureFlag?: boolean };

export const FOOTER_NAV_SECTIONS: FooterNavSection[] = [
  {
    title: "Browse",
    items: [
      { kind: "link", label: "Skills", to: "/skills", search: SKILLS_SEARCH },
      { kind: "link", label: "Plugins", to: "/plugins" },
      {
        kind: "link",
        label: "Souls",
        to: "/souls",
        search: SOULS_SEARCH,
        featureFlag: FEATURE_SOULS,
      },
    ],
  },
  {
    title: "Publish",
    items: [
      {
        kind: "link",
        label: "Publish Skill",
        to: "/publish-skill",
        search: { updateSlug: undefined },
      },
      {
        kind: "link",
        label: "Publish Plugin",
        to: "/publish-plugin",
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Filter a nav item array based on current mode/auth/staff context. */
export function filterNavItems(
  items: NavItem[],
  ctx: { isSoulMode: boolean; isAuthenticated: boolean; isStaff: boolean },
): NavItem[] {
  return items.filter((item) => {
    if (item.soulModeOnly && !ctx.isSoulMode) return false;
    if (item.soulModeHide && ctx.isSoulMode) return false;
    if (item.authRequired && !ctx.isAuthenticated) return false;
    if (item.staffOnly && !ctx.isStaff) return false;
    if (item.featureFlag === false) return false;
    return true;
  });
}
