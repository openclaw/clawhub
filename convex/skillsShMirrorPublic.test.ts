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
  });

  it("returns null while the skills.sh runtime is disabled", async () => {
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "off");
    const runQuery = vi.fn();

    await expect(getSkillsShMirrorByRoute({ runQuery } as never, route)).resolves.toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });
});
