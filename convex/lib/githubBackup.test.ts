import { afterEach, describe, expect, it } from "vitest";
import { getGitHubBackupSettings } from "./githubBackup";

describe("github backup settings", () => {
  const originalRepo = process.env.GITHUB_SKILLS_REPO;
  const originalRoot = process.env.GITHUB_SKILLS_ROOT;

  afterEach(() => {
    setEnv("GITHUB_SKILLS_REPO", originalRepo);
    setEnv("GITHUB_SKILLS_ROOT", originalRoot);
  });

  it("defaults registry artifact backups to the private ClawHub backup repo", () => {
    delete process.env.GITHUB_SKILLS_REPO;
    delete process.env.GITHUB_SKILLS_ROOT;

    expect(getGitHubBackupSettings()).toEqual({
      repo: "openclaw/clawhub-backup",
      root: "hosted-skills",
    });
  });

  it("keeps the existing environment override names for deployment compatibility", () => {
    process.env.GITHUB_SKILLS_REPO = "example/backups";
    process.env.GITHUB_SKILLS_ROOT = "mirror/skills";

    expect(getGitHubBackupSettings()).toEqual({
      repo: "example/backups",
      root: "mirror/skills",
    });
  });
});

function setEnv(name: "GITHUB_SKILLS_REPO" | "GITHUB_SKILLS_ROOT", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
