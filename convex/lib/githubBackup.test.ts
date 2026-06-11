import { afterEach, describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { buildPackageReleaseBackupManifest, getGitHubBackupSettings } from "./githubBackup";

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
      packageRoot: "package-releases",
    });
  });

  it("keeps the existing environment override names for deployment compatibility", () => {
    process.env.GITHUB_SKILLS_REPO = "example/backups";
    process.env.GITHUB_SKILLS_ROOT = "mirror/skills";

    expect(getGitHubBackupSettings()).toEqual({
      repo: "example/backups",
      root: "mirror/skills",
      packageRoot: "package-releases",
    });
  });

  it("allows package artifact root overrides independently of hosted skills", () => {
    process.env.GITHUB_PACKAGE_ARTIFACTS_ROOT = "registry/packages";

    expect(getGitHubBackupSettings().packageRoot).toBe("registry/packages");

    delete process.env.GITHUB_PACKAGE_ARTIFACTS_ROOT;
  });

  it("builds package release backup paths and restore metadata", () => {
    const manifest = buildPackageReleaseBackupManifest({
      root: "package-releases",
      repo: "openclaw/clawhub-backup",
      ownerHandle: "OpenClaw Team",
      packageId: "packages:demo" as Id<"packages">,
      releaseId: "packageReleases:demo-1" as Id<"packageReleases">,
      packageName: "@openclaw/demo-plugin",
      normalizedName: "@openclaw/demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "1.2.3",
      publishedAt: 1_700_000_000_000,
      artifactKind: "npm-pack",
      artifactFileName: "demo-plugin-1.2.3.tgz",
      artifactSha256: "sha256:artifact",
      artifactSize: 42,
      artifactFormat: "tgz",
      npmIntegrity: "sha512-demo",
      npmShasum: "abc123",
      npmUnpackedSize: 1234,
      npmFileCount: 8,
      runtimeId: "demo-plugin",
      sourceRepo: "openclaw/demo-plugin",
      compatibility: { openclaw: ">=2026.1.0" },
      capabilities: { executesCode: true, capabilityTags: ["dev-tools"] },
      extractedPackageJson: { name: "@openclaw/demo-plugin", version: "1.2.3" },
      extractedPluginManifest: { id: "demo-plugin" },
      files: [{ path: "package.json", size: 10, sha256: "sha256:package-json" }],
    });

    expect(manifest).toMatchObject({
      packageRoot: "package-releases/openclaw-team/openclaw-demo-plugin",
      releaseRoot: "package-releases/openclaw-team/openclaw-demo-plugin/1.2.3",
      artifactPath:
        "package-releases/openclaw-team/openclaw-demo-plugin/1.2.3/demo-plugin-1.2.3.tgz",
      metaPath: "package-releases/openclaw-team/openclaw-demo-plugin/1.2.3/_meta.json",
      indexPath: "package-releases/openclaw-team/openclaw-demo-plugin/_index.json",
      meta: {
        kind: "packageRelease",
        owner: "openclaw-team",
        packageName: "@openclaw/demo-plugin",
        normalizedName: "@openclaw/demo-plugin",
        version: "1.2.3",
        artifact: {
          path: "demo-plugin-1.2.3.tgz",
          sha256: "sha256:artifact",
          size: 42,
          format: "tgz",
          npmIntegrity: "sha512-demo",
          npmShasum: "abc123",
        },
        restore: {
          packageId: "packages:demo",
          releaseId: "packageReleases:demo-1",
        },
      },
    });
  });
});

function setEnv(
  name: "GITHUB_SKILLS_REPO" | "GITHUB_SKILLS_ROOT" | "GITHUB_PACKAGE_ARTIFACTS_ROOT",
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
