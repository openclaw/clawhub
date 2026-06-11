import { afterEach, describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  __githubBackupTestInternals,
  buildPackageReleaseBackupManifest,
  getGitHubBackupSettings,
} from "./githubBackup";

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
      packageRoot: "package-releases/openclaw-team/%40openclaw%2Fdemo-plugin",
      releaseRoot: "package-releases/openclaw-team/%40openclaw%2Fdemo-plugin/1%2E2%2E3",
      artifactPath:
        "package-releases/openclaw-team/%40openclaw%2Fdemo-plugin/1%2E2%2E3/demo-plugin-1.2.3.tgz",
      metaPath: "package-releases/openclaw-team/%40openclaw%2Fdemo-plugin/1%2E2%2E3/_meta.json",
      indexPath: "package-releases/openclaw-team/%40openclaw%2Fdemo-plugin/_index.json",
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

  it("uses lossless package path encoding to avoid package name collisions", () => {
    expect(__githubBackupTestInternals.encodeBackupPathSegment("@openclaw/demo-plugin")).toBe(
      "%40openclaw%2Fdemo-plugin",
    );
    expect(__githubBackupTestInternals.encodeBackupPathSegment("openclaw-demo-plugin")).toBe(
      "openclaw-demo-plugin",
    );
    expect(__githubBackupTestInternals.encodeBackupPathSegment("foo.bar")).toBe("foo%2Ebar");
    expect(__githubBackupTestInternals.encodeBackupPathSegment("foo_bar")).toBe("foo_bar");
    expect(__githubBackupTestInternals.encodeBackupPathSegment("foo-bar")).toBe("foo-bar");
  });

  it("marks artifacts above the GitHub blob limit without retrying a doomed blob upload", () => {
    const manifest = buildPackageReleaseBackupManifest({
      root: "package-releases",
      repo: "openclaw/clawhub-backup",
      ownerHandle: "OpenClaw Team",
      packageId: "packages:demo" as Id<"packages">,
      releaseId: "packageReleases:demo-large" as Id<"packageReleases">,
      packageName: "@openclaw/demo-plugin",
      normalizedName: "@openclaw/demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "1.2.3",
      publishedAt: 1_700_000_000_000,
      files: [],
    });

    expect(
      __githubBackupTestInternals.applyPackageArtifactMirrorStatus(manifest, 101 * 1024 * 1024),
    ).toBe(true);
    expect(manifest.meta.artifact).toMatchObject({
      mirrorStatus: "skipped-too-large",
      githubBlobMaxBytes: 100 * 1024 * 1024,
    });
  });

  it("keeps the package index latest pointer on the newest published release", () => {
    const olderManifest = buildPackageReleaseBackupManifest({
      root: "package-releases",
      repo: "openclaw/clawhub-backup",
      ownerHandle: "OpenClaw Team",
      packageId: "packages:demo" as Id<"packages">,
      releaseId: "packageReleases:demo-1" as Id<"packageReleases">,
      packageName: "@openclaw/demo-plugin",
      normalizedName: "@openclaw/demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "1.0.0",
      publishedAt: 1_700_000_000_000,
      files: [],
    });

    const index = __githubBackupTestInternals.buildPackageIndexFile(
      olderManifest,
      {
        kind: "package",
        owner: "openclaw-team",
        packageName: "@openclaw/demo-plugin",
        normalizedName: "@openclaw/demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        latest: {
          version: "2.0.0",
          publishedAt: 1_800_000_000_000,
          releaseId: "packageReleases:demo-2" as Id<"packageReleases">,
          path: "package-releases/openclaw-team/%40openclaw%2Fdemo-plugin/2%2E0%2E0/_meta.json",
          commit: "newer-commit",
        },
        releases: [],
      },
      "older-commit",
    );

    expect(index.latest).toMatchObject({
      version: "2.0.0",
      releaseId: "packageReleases:demo-2",
      commit: "newer-commit",
    });
    expect(index.releases.map((release) => release.version)).toEqual(["2.0.0", "1.0.0"]);
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
