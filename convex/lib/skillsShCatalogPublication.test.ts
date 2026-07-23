import { describe, expect, it } from "vitest";
import {
  buildSkillsShCatalogInstallResolution,
  resolveSkillsShCatalogActiveSource,
  shouldPublishSkillsShCatalogEntry,
} from "./skillsShCatalogPublication";

const entry = {
  externalId: "patrick-erichsen/skills/html",
  githubOwnerId: 20_157_849,
  owner: "patrick-erichsen",
  repo: "skills",
  slug: "html",
  githubPath: "skills/html",
  githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
  githubContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
  sourceContentHash: "source-hash",
};

const attempt = {
  externalId: entry.externalId,
  githubOwnerId: entry.githubOwnerId,
  owner: entry.owner,
  repo: entry.repo,
  slug: entry.slug,
  githubPath: entry.githubPath,
  githubCommit: entry.githubCommit,
  githubContentHash: entry.githubContentHash,
  sourceContentHash: entry.sourceContentHash,
  dispatchKind: "real" as const,
  source: "skills-sh-catalog-test" as const,
};

const control = {
  mode: "staging-live" as const,
  paused: false,
  publicVisibilityEnabled: true,
  realScanAllowlist: [entry.externalId],
};

describe("skills.sh catalog publication", () => {
  it.each(["clean", "suspicious"] as const)(
    "publishes an exact %s result while visibility is enabled",
    (verdict) => {
      expect(shouldPublishSkillsShCatalogEntry({ control, entry, attempt, verdict })).toBe(true);
    },
  );

  it("accepts a pointer-only refresh while serving the explicit active candidate", () => {
    expect(
      shouldPublishSkillsShCatalogEntry({
        control,
        entry: { ...entry, githubCommit: "1".repeat(40) },
        attempt,
        verdict: "clean",
      }),
    ).toBe(true);
    expect(
      resolveSkillsShCatalogActiveSource({
        entry: { ...entry, githubCommit: "1".repeat(40) },
        attempt,
      }),
    ).toMatchObject({
      githubCommit: attempt.githubCommit,
      sourceContentHash: entry.sourceContentHash,
    });
  });

  it("keeps the prior allowed source active while changed content is pending", () => {
    const changed = {
      ...entry,
      githubCommit: "2".repeat(40),
      githubContentHash: "2".repeat(64),
      sourceContentHash: "changed-source-hash",
    };
    expect(
      shouldPublishSkillsShCatalogEntry({
        control,
        entry: changed,
        attempt,
        verdict: "clean",
      }),
    ).toBe(false);
    expect(resolveSkillsShCatalogActiveSource({ entry: changed, attempt })).toEqual(attempt);
  });

  it.each(["malicious", "failed"] as const)("never publishes a %s result", (verdict) => {
    expect(shouldPublishSkillsShCatalogEntry({ control, entry, attempt, verdict })).toBe(false);
  });

  it("rejects a deterministic fixture attempt", () => {
    expect(
      shouldPublishSkillsShCatalogEntry({
        control,
        entry,
        attempt: {
          ...attempt,
          dispatchKind: "deterministic",
          source: "skills-sh-catalog-fixture",
        },
        verdict: "clean",
      }),
    ).toBe(false);
  });

  it("rejects an exact attempt removed from the active allowlist", () => {
    expect(
      shouldPublishSkillsShCatalogEntry({
        control: { ...control, realScanAllowlist: [] },
        entry,
        attempt,
        verdict: "clean",
      }),
    ).toBe(false);
  });

  it("returns the approved commit-pinned GitHub descriptor with slash identity", () => {
    expect(buildSkillsShCatalogInstallResolution(entry)).toEqual({
      ok: true,
      slug: "skills-sh/patrick-erichsen/skills/html",
      installKind: "github",
      github: {
        repo: "patrick-erichsen/skills",
        path: "skills/html",
        commit: "050daba89f6b6636470add5cb300aac46a412cf8",
        contentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
        sourceUrl:
          "https://github.com/patrick-erichsen/skills/tree/050daba89f6b6636470add5cb300aac46a412cf8/skills/html",
      },
    });
  });
});
