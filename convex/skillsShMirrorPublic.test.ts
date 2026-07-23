import { describe, expect, it, vi } from "vitest";
import type { SkillsShMirrorDetail, SkillsShMirrorDigest } from "./lib/skillsShMirrorPublic";
import { getSkillsShMirrorByRoute } from "./skillsShMirrorPublic";

const digest: SkillsShMirrorDigest = {
  externalId: "patrick-erichsen/skills/html",
  sourceType: "github",
  owner: "patrick-erichsen",
  repo: "skills",
  slug: "html",
  displayName: "HTML Artifact Chooser",
  sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
  canonicalRepoUrl: "https://github.com/patrick-erichsen/skills",
  githubPath: "skills/html",
  githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
  sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
  upstreamInstalls: 100,
  upstreamScanners: {
    genAgentTrustHub: { status: "unavailable" },
    socket: { status: "pass" },
    snyk: { status: "warning" },
  },
  sourceFreshnessStatus: "observed-only",
  detailStatus: "available",
  active: true,
  publicVisible: false,
  installable: false,
  lastObservedAt: 123,
};

const detail: SkillsShMirrorDetail = {
  externalId: digest.externalId,
  contentKind: "skill-md",
  path: "skills/html/SKILL.md",
  content: "# HTML",
  contentBytes: 6,
  sourceBytes: 6,
  sourceFileCount: 1,
  truncated: false,
  sourceContentHash: digest.sourceContentHash,
  updatedAt: 123,
};

describe("skillsShMirrorPublic.getByRoute", () => {
  it("loads the digest and bounded detail in parallel", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce(digest).mockResolvedValueOnce(detail);

    const result = await getSkillsShMirrorByRoute({ runQuery } as never, {
      owner: "Patrick-Erichsen",
      repo: "Skills",
      slug: "HTML",
    });

    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runQuery.mock.calls.map((call) => call[1])).toEqual([
      { externalId: "patrick-erichsen/skills/html" },
      { externalId: "patrick-erichsen/skills/html" },
    ]);
    expect(result).toMatchObject({
      reference: "skills-sh:patrick-erichsen/skills/html",
      content: {
        path: "skills/html/SKILL.md",
        markdown: "# HTML",
      },
    });
  });

  it("rejects malformed paths without reading the mirror", async () => {
    const runQuery = vi.fn();

    const result = await getSkillsShMirrorByRoute({ runQuery } as never, {
      owner: "patrick-erichsen",
      repo: "..",
      slug: "html",
    });

    expect(result).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });
});
