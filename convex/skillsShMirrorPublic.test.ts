import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSkillsShMirrorByRoute } from "./skillsShMirrorPublic";

const route = { owner: "patrick-erichsen", repo: "skills", slug: "html" };

beforeEach(() => {
  vi.stubEnv("CLAWHUB_ENV", "test");
  vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
});

afterEach(() => vi.unstubAllEnvs());

describe("skillsShMirrorPublic.getSkillsShMirrorByRoute", () => {
  it("redirects a promoted alias after the external row is hidden", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        externalId: "patrick-erichsen/skills/html",
        canonicalRepoUrl: "https://github.com/openclaw/openclaw",
        githubPath: "skills/html",
        publicVisible: false,
        installable: false,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        canonicalRoute: "/openclaw/skills/html",
        canonicalRef: "@openclaw/html",
      });

    await expect(getSkillsShMirrorByRoute({ runQuery } as never, route)).resolves.toEqual({
      kind: "redirect",
      canonicalRoute: "/openclaw/skills/html",
      canonicalRef: "@openclaw/html",
    });
    expect(runQuery.mock.calls[2]?.[1]).toEqual({
      repo: "openclaw/openclaw",
      path: "skills/html",
    });
  });

  it("returns null while the skills.sh runtime is disabled", async () => {
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "off");
    const runQuery = vi.fn();

    await expect(getSkillsShMirrorByRoute({ runQuery } as never, route)).resolves.toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("keeps an eligible mirror hidden while the atomic public catalog gate is off", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        externalId: "patrick-erichsen/skills/html",
        sourceType: "github",
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
        displayName: "HTML",
        sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
        canonicalRepoUrl: "https://github.com/patrick-erichsen/skills",
        githubPath: "skills/html",
        githubCommit: "c".repeat(40),
        sourceContentHash: "a".repeat(64),
        upstreamInstalls: 1,
        upstreamScanners: {
          genAgentTrustHub: { status: "pass" },
          socket: { status: "pass" },
          snyk: { status: "warn" },
        },
        sourceFreshnessStatus: "observed-only",
        detailStatus: "available",
        active: true,
        publicVisible: true,
        installable: true,
        lastObservedAt: 1,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ skillsSh: { publicCatalogEnabled: false } });

    await expect(getSkillsShMirrorByRoute({ runQuery } as never, route)).resolves.toBeNull();
  });
});
