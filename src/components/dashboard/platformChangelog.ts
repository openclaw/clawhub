import { CLAWHUB_REPOSITORY_URL, clawhubDocsUrl } from "../../lib/publicRegistry";

export const CLAWHUB_PLATFORM_CHANGELOG_URL = `${CLAWHUB_REPOSITORY_URL}/releases`;

export type PlatformChangelogCategory = "Feature" | "Improvement";

export type PlatformChangelogEntry = {
  id: string;
  /** Human-readable date label shown in the timeline. */
  when: string;
  /** Optional ISO date for the `<time dateTime>` attribute. */
  iso?: string;
  category: PlatformChangelogCategory;
  title: string;
  /** Internal TanStack route target. */
  to?: string;
  search?: Record<string, unknown>;
  /** External URL (docs, GitHub, etc.). */
  href?: string;
};

/** Curated ClawHub platform updates shown in the dashboard sidebar. */
export const PLATFORM_CHANGELOG_ENTRIES: PlatformChangelogEntry[] = [
  {
    id: "github-import",
    when: "Recent",
    category: "Feature",
    title: "Import skills from GitHub",
    to: "/import",
  },
  {
    id: "publisher-workspace",
    when: "Recent",
    category: "Feature",
    title: "Publisher workspace on the dashboard",
    to: "/dashboard",
  },
  {
    id: "download-insights",
    when: "Recent",
    category: "Feature",
    title: "Download insights for your catalog",
    to: "/dashboard",
  },
  {
    id: "needs-attention",
    when: "Recent",
    category: "Improvement",
    title: "Needs attention strip for validation issues",
    to: "/dashboard",
    search: { kind: "attention" },
  },
  {
    id: "plugin-validation",
    when: "Jun 2026",
    iso: "2026-06-06",
    category: "Improvement",
    title: "Plugin validation findings and fix guides",
    href: clawhubDocsUrl("plugin-validation-fixes"),
  },
  {
    id: "org-publisher-logos",
    when: "Jun 2026",
    iso: "2026-06-23",
    category: "Improvement",
    title: "Upload org publisher logos from settings",
    to: "/settings",
    search: { view: "organizations" },
  },
];
