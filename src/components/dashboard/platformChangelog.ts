import { CLAWHUB_REPOSITORY_URL, clawhubDocsUrl } from "../../lib/publicRegistry";

export const CLAWHUB_PLATFORM_CHANGELOG_URL = `${CLAWHUB_REPOSITORY_URL}/releases`;

export type PlatformChangelogCategory = "Feature" | "Improvement";
export type PlatformChangelogSurface = "Web" | "CLI" | "API";

export type PlatformChangelogEntry = {
  id: string;
  /** Human-readable date label shown in the timeline. */
  when: string;
  /** Optional ISO date for the `<time dateTime>` attribute. */
  iso?: string;
  category: PlatformChangelogCategory;
  surfaces: PlatformChangelogSurface[];
  title: string;
  summary: string;
  details: string;
  actionLabel: string;
  /** Internal TanStack route target. */
  to?: string;
  search?: Record<string, unknown>;
  /** External URL (docs, GitHub, etc.). */
  href?: string;
};

/** Curated public releases shared by the changelog page and dashboard sidebar. */
export const PLATFORM_CHANGELOG_ENTRIES: PlatformChangelogEntry[] = [
  {
    id: "publisher-workspace",
    when: "Jun 27, 2026",
    iso: "2026-06-27",
    category: "Feature",
    surfaces: ["Web"],
    title: "A real publisher workspace",
    summary: "ClawHub now brings daily publisher operations into one workspace.",
    details:
      "The dashboard evolved into a publisher workspace where packages, attention items, validation review, download stats, abuse review, publisher context, post-publish sharing, and platform updates live closer together. The result is a clearer home for daily publishing operations instead of a basic account page.",
    actionLabel: "Open dashboard",
    to: "/dashboard",
  },
  {
    id: "security-review-surfaces",
    when: "Jun 25, 2026",
    iso: "2026-06-25",
    category: "Improvement",
    surfaces: ["Web", "API"],
    title: "SkillSpector and ClawScan review surfaces",
    summary: "Security findings now form a clearer trust and review workflow.",
    details:
      "ClawHub added scanner-specific pages, rescan requests, flagged owner inventory, SkillSpector issue exports, remediation guidance, package rescans, ClawScan datasets, and download blocking for malicious skill versions. Together, these changes make trust state easier to inspect, understand, and act on.",
    actionLabel: "Browse security audits",
    to: "/audits",
  },
  {
    id: "catalog-browsing",
    when: "Jun 25, 2026",
    iso: "2026-06-25",
    category: "Improvement",
    surfaces: ["Web"],
    title: "Better browsing for skills, plugins, and creators",
    summary: "Skills, Plugins, and Creators now have clearer discovery surfaces.",
    details:
      "Listings were tightened, plugin cards now emphasize downloads instead of noisy secondary metrics, creator search became part of global discovery, and official or verified publishers are easier to recognize across search and browse.",
    actionLabel: "Explore the catalog",
    to: "/skills",
  },
  {
    id: "owner-aware-catalog",
    when: "Jun 25, 2026",
    iso: "2026-06-25",
    category: "Feature",
    surfaces: ["Web", "API"],
    title: "Owner-aware catalog routes and verified feeds",
    summary: "Owner-qualified routes and verified feeds make discovery more reliable.",
    details:
      "Catalog pages now understand owner-qualified routes, verified publisher feeds, and hosted OpenClaw plugin feeds. This avoids slug collisions and gives official organization and personal publishers a stronger foundation for routing, search, and public package discovery.",
    actionLabel: "Browse verified packages",
    to: "/skills",
  },
  {
    id: "github-import",
    when: "Jun 25, 2026",
    iso: "2026-06-25",
    category: "Feature",
    surfaces: ["Web"],
    title: "GitHub import and publishing flow improvements",
    summary: "GitHub import now carries repository metadata into publishing.",
    details:
      "Publishers can bring in public GitHub skills, authenticate repository discovery, prefill package summaries from SKILL.md, and keep publisher context through the add flow. Better defaults reduce the places where authors have to rebuild metadata by hand.",
    actionLabel: "Start a GitHub import",
    to: "/import",
  },
  {
    id: "homepage-refresh",
    when: "Jun 22, 2026",
    iso: "2026-06-22",
    category: "Improvement",
    surfaces: ["Web"],
    title: "A cleaner ClawHub homepage",
    summary: "The homepage now prioritizes faster, calmer catalog discovery.",
    details:
      "ClawHub's homepage was rebuilt around clearer browse paths and a calmer first impression. The new hero, simplified listing tabs, cached homepage sections, and removed suggestion and proof clutter make the front door feel like a product catalog rather than an internal dashboard.",
    actionLabel: "Visit the homepage",
    to: "/",
  },
  {
    id: "clawpack-pipeline",
    when: "May 2, 2026",
    iso: "2026-05-02",
    category: "Feature",
    surfaces: ["CLI", "API"],
    title: "Clawpack support across CLI and API",
    summary: "Clawpack artifacts can now move through ClawHub end to end.",
    details:
      "The package pipeline now supports packing, uploading, verifying, mirroring, downloading, and publishing Clawpack artifacts through the CLI and API. Together, these capabilities establish an end-to-end path for plugin and package artifacts.",
    actionLabel: "Read the CLI guide",
    href: clawhubDocsUrl("cli"),
  },
  {
    id: "package-operations",
    when: "May 2, 2026",
    iso: "2026-05-02",
    category: "Improvement",
    surfaces: ["CLI", "API"],
    title: "Package moderation, appeals, and migration tools",
    summary: "Packages now have operational paths for review and recovery.",
    details:
      "Package operations now include moderation queues, report triage, appeals, migration status, artifact filters, environment metadata, and host-target checks. These controls make publishing governable and recoverable instead of treating packages as records the platform can only display.",
    actionLabel: "Read the moderation guide",
    href: clawhubDocsUrl("moderation"),
  },
];
