// One-time rewrite of the community Template listings whose stored categories predate the
// 2026-11-18 taxonomy (see specs/template-categories.md). Each row names one listing, the publisher
// expected to own it, the categories it stored when the mapping was reviewed, and the single
// category it moves to. Eleven listings led with a removed category and move to a target the
// catalog owner chose by hand; those are not derivable by rule. The other twenty-one keep
// their first category, which is also what republishing their unchanged CLAW.md assigns.
// First-party `openclaw` listings are deliberately absent and are never rewritten.
export const TEMPLATE_CATEGORY_BACKFILL_VERSION = "template-category-taxonomy-2026-11-18";

export type TemplateCategoryBackfillEntry = {
  name: string;
  owner: string;
  expectedCurrent: readonly string[];
  next: readonly [string];
};

export const TEMPLATE_CATEGORY_BACKFILL: readonly TemplateCategoryBackfillEntry[] = [
  {
    name: "@anmol0b/ci-failure-triager",
    owner: "anmol0b",
    expectedCurrent: ["engineering", "operations"],
    next: ["engineering"],
  },
  {
    name: "@anmol0b/dependency-update-reviewer",
    owner: "anmol0b",
    expectedCurrent: ["engineering", "operations"],
    next: ["engineering"],
  },
  {
    name: "@anmol0b/release-notes-drafter",
    owner: "anmol0b",
    expectedCurrent: ["engineering", "product"],
    next: ["engineering"],
  },
  {
    name: "@anmol0b/repo-maintainer-helper",
    owner: "anmol0b",
    expectedCurrent: ["engineering", "productivity"],
    next: ["engineering"],
  },
  {
    name: "@anmol0b/stale-work-sweeper",
    owner: "anmol0b",
    expectedCurrent: ["engineering", "productivity"],
    next: ["engineering"],
  },
  {
    name: "@daniel-lxs/orchestrator",
    owner: "daniel-lxs",
    expectedCurrent: ["engineering", "productivity"],
    next: ["engineering"],
  },
  {
    name: "@donniefi/hopper",
    owner: "donniefi",
    expectedCurrent: ["travel", "personal"],
    next: ["travel"],
  },
  {
    name: "@ekinnee/campaign-keeper",
    owner: "ekinnee",
    expectedCurrent: ["personal"],
    next: ["entertainment"],
  },
  {
    name: "@ekinnee/language-conversation-partner",
    owner: "ekinnee",
    expectedCurrent: ["personal", "productivity"],
    next: ["entertainment"],
  },
  {
    name: "@etzelm/job-application-coordinator",
    owner: "etzelm",
    expectedCurrent: ["personal", "productivity"],
    next: ["productivity"],
  },
  {
    name: "@holgergruenhagen/agent-workspace-reviewer",
    owner: "holgergruenhagen",
    expectedCurrent: ["operations", "governance"],
    next: ["operations"],
  },
  {
    name: "@holgergruenhagen/mac-workstation-steward",
    owner: "holgergruenhagen",
    expectedCurrent: ["operations", "productivity"],
    next: ["operations"],
  },
  {
    name: "@holgergruenhagen/monitoring-coverage-steward",
    owner: "holgergruenhagen",
    expectedCurrent: ["operations", "engineering"],
    next: ["operations"],
  },
  {
    name: "@holgergruenhagen/self-hosted-instance-steward",
    owner: "holgergruenhagen",
    expectedCurrent: ["operations", "engineering"],
    next: ["operations"],
  },
  {
    name: "@holgergruenhagen/service-migration-coordinator",
    owner: "holgergruenhagen",
    expectedCurrent: ["operations", "engineering"],
    next: ["operations"],
  },
  {
    name: "@holgergruenhagen/upstream-contribution-steward",
    owner: "holgergruenhagen",
    expectedCurrent: ["engineering", "research"],
    next: ["engineering"],
  },
  {
    name: "@holgergruenhagen/upstream-fix-tracker",
    owner: "holgergruenhagen",
    expectedCurrent: ["operations", "engineering"],
    next: ["operations"],
  },
  {
    name: "@holgergruenhagen/wordpress-site-steward",
    owner: "holgergruenhagen",
    expectedCurrent: ["operations", "engineering"],
    next: ["operations"],
  },
  {
    name: "@jjjhenriksen/celebration-coordinator",
    owner: "jjjhenriksen",
    expectedCurrent: ["personal", "productivity"],
    next: ["household"],
  },
  {
    name: "@jjjhenriksen/meal-planner",
    owner: "jjjhenriksen",
    expectedCurrent: ["personal", "productivity"],
    next: ["household"],
  },
  {
    name: "@jjjhenriksen/travel-copilot",
    owner: "jjjhenriksen",
    expectedCurrent: ["travel", "personal"],
    next: ["travel"],
  },
  {
    name: "@mertbasar0/discord-signal-radar",
    owner: "mertbasar0",
    expectedCurrent: ["operations", "research"],
    next: ["operations"],
  },
  {
    name: "@mertbasar0/handoff-coordinator",
    owner: "mertbasar0",
    expectedCurrent: ["engineering", "operations"],
    next: ["engineering"],
  },
  {
    name: "@mertbasar0/pr-review-radar",
    owner: "mertbasar0",
    expectedCurrent: ["engineering", "operations"],
    next: ["engineering"],
  },
  {
    name: "@tssala23/cooking-companion",
    owner: "tssala23",
    expectedCurrent: ["personal"],
    next: ["household"],
  },
  {
    name: "@tssala23/gaming-companion",
    owner: "tssala23",
    expectedCurrent: ["personal"],
    next: ["entertainment"],
  },
  {
    name: "bernie-house-griffon",
    owner: "donniefi",
    expectedCurrent: ["personal"],
    next: ["household"],
  },
  { name: "hopper", owner: "donniefi", expectedCurrent: ["travel", "personal"], next: ["travel"] },
  { name: "meals", owner: "donniefi", expectedCurrent: ["personal"], next: ["household"] },
  {
    name: "myfitnessclaw",
    owner: "ameliomansour",
    expectedCurrent: ["health", "personal"],
    next: ["health"],
  },
  {
    name: "openclaw-music-manager",
    owner: "ameliomansour",
    expectedCurrent: ["personal", "productivity"],
    next: ["entertainment"],
  },
  {
    name: "tutor",
    owner: "donniefi",
    expectedCurrent: ["personal", "research"],
    next: ["entertainment"],
  },
];

function sameCategories(left: readonly string[] | undefined, right: readonly string[]) {
  return left?.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * What the backfill may do to one listing, from its stored categories alone. Anything other
 * than the reviewed starting value or the target means the listing changed since review (for
 * example its author published again), so it is left alone and reported.
 */
export function planTemplateCategoryBackfill(
  stored: readonly string[] | undefined,
  entry: Pick<TemplateCategoryBackfillEntry, "expectedCurrent" | "next">,
): "apply" | "applied" | "drifted" {
  if (sameCategories(stored, entry.next)) return "applied";
  return sameCategories(stored, entry.expectedCurrent) ? "apply" : "drifted";
}
