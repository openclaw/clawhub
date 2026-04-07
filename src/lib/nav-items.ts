/**
 * Shared navigation configuration used by Header and Footer to eliminate
 * triple duplication of nav link definitions.
 */

export interface NavItem {
  /** Visible link text */
  label: string;
  /** Route path passed to `<Link to>` */
  to: string;
  /** Optional search params object passed to `<Link search>` */
  search?: Record<string, unknown>;
  /** Link only shown when user is authenticated */
  authRequired: boolean;
  /** Link only shown for staff / moderator users */
  staffOnly: boolean;
  /** Link only shown when siteMode === "souls" */
  soulModeOnly: boolean;
  /** Link hidden when siteMode === "souls" */
  soulModeHide: boolean;
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

const MANAGEMENT_SEARCH = { skill: undefined } as const;

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
    authRequired: false,
    staffOnly: false,
    soulModeOnly: false,
    soulModeHide: true,
  },
  {
    label: "Plugins",
    to: "/plugins",
    authRequired: false,
    staffOnly: false,
    soulModeOnly: false,
    soulModeHide: true,
  },
  {
    label: "Souls",
    to: "/souls",
    search: SOULS_SEARCH,
    authRequired: false,
    staffOnly: false,
    soulModeOnly: false,
    // In soul-mode this is the primary tab; in skills-mode it is also shown.
    soulModeHide: false,
  },
];

// ---------------------------------------------------------------------------
// Secondary nav items (secondary tabs row + mobile dropdown lower section)
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
  {
    label: "Stars",
    to: "/stars",
    authRequired: true,
    staffOnly: false,
    soulModeOnly: false,
    soulModeHide: false,
  },
  {
    label: "Dashboard",
    to: "/dashboard",
    authRequired: true,
    staffOnly: false,
    soulModeOnly: false,
    soulModeHide: false,
  },
  {
    label: "Management",
    to: "/management",
    search: MANAGEMENT_SEARCH,
    authRequired: true,
    staffOnly: true,
    soulModeOnly: false,
    soulModeHide: false,
  },
];

// ---------------------------------------------------------------------------
// Footer sections
// ---------------------------------------------------------------------------

export interface FooterNavSection {
  title: string;
  items: FooterNavItem[];
}

export type FooterNavItem =
  | { kind: "link"; label: string; to: string; search?: Record<string, unknown> }
  | { kind: "external"; label: string; href: string }
  | { kind: "text"; label: string };

export const FOOTER_NAV_SECTIONS: FooterNavSection[] = [
  {
    title: "Browse",
    items: [
      { kind: "link", label: "Skills", to: "/skills", search: SKILLS_SEARCH },
      { kind: "link", label: "Plugins", to: "/plugins" },
      { kind: "link", label: "Souls", to: "/souls", search: SOULS_SEARCH },
      { kind: "link", label: "Users", to: "/users" },
      {
        kind: "link",
        label: "Staff Picks",
        to: "/skills",
        search: {
          q: undefined,
          sort: undefined,
          dir: undefined,
          highlighted: true,
          nonSuspicious: undefined,
          view: undefined,
          focus: undefined,
        },
      },
      {
        kind: "link",
        label: "Search",
        to: "/search",
        search: { q: undefined, type: undefined },
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
      {
        kind: "external",
        label: "Documentation",
        href: "https://github.com/openclaw/clawhub",
      },
    ],
  },
  {
    title: "Community",
    items: [
      { kind: "external", label: "GitHub", href: "https://github.com/openclaw/clawhub" },
      { kind: "link", label: "About", to: "/about" },
      { kind: "external", label: "OpenClaw", href: "https://openclaw.ai" },
    ],
  },
  {
    title: "Platform",
    items: [
      { kind: "text", label: "MIT Licensed" },
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
    return true;
  });
}
