import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  __registryArtifactBackupTestInternals,
  backupPackageReleaseToObjectStorage,
  backupSkillVersionToObjectStorage,
  buildPackageReleaseBackupManifest,
  buildSkillVersionBackupManifest,
  fetchSkillBackupIndex,
  getRegistryArtifactBackupSettings,
  readRegistryArtifactBackupObject,
} from "./registryArtifactBackup";

describe("registry artifact backup settings", () => {
  const originalEnv = {
    endpoint: process.env.REGISTRY_BACKUP_S3_ENDPOINT,
    accountId: process.env.REGISTRY_BACKUP_R2_ACCOUNT_ID,
    bucket: process.env.REGISTRY_BACKUP_BUCKET,
    accessKeyId: process.env.REGISTRY_BACKUP_ACCESS_KEY_ID,
    secretAccessKey: process.env.REGISTRY_BACKUP_SECRET_ACCESS_KEY,
    region: process.env.REGISTRY_BACKUP_S3_REGION,
    skillsRoot: process.env.REGISTRY_BACKUP_SKILLS_ROOT,
    packagesRoot: process.env.REGISTRY_BACKUP_PACKAGES_ROOT,
  };

  afterEach(() => {
    setEnv("REGISTRY_BACKUP_S3_ENDPOINT", originalEnv.endpoint);
    setEnv("REGISTRY_BACKUP_R2_ACCOUNT_ID", originalEnv.accountId);
    setEnv("REGISTRY_BACKUP_BUCKET", originalEnv.bucket);
    setEnv("REGISTRY_BACKUP_ACCESS_KEY_ID", originalEnv.accessKeyId);
    setEnv("REGISTRY_BACKUP_SECRET_ACCESS_KEY", originalEnv.secretAccessKey);
    setEnv("REGISTRY_BACKUP_S3_REGION", originalEnv.region);
    setEnv("REGISTRY_BACKUP_SKILLS_ROOT", originalEnv.skillsRoot);
    setEnv("REGISTRY_BACKUP_PACKAGES_ROOT", originalEnv.packagesRoot);
  });

  it("defaults registry artifact backups to skills and packages object roots", () => {
    delete process.env.REGISTRY_BACKUP_S3_ENDPOINT;
    process.env.REGISTRY_BACKUP_R2_ACCOUNT_ID = "account-id";
    process.env.REGISTRY_BACKUP_BUCKET = "clawhub-registry-backup";
    process.env.REGISTRY_BACKUP_ACCESS_KEY_ID = "access-key";
    process.env.REGISTRY_BACKUP_SECRET_ACCESS_KEY = "secret-key";
    delete process.env.REGISTRY_BACKUP_S3_REGION;
    delete process.env.REGISTRY_BACKUP_SKILLS_ROOT;
    delete process.env.REGISTRY_BACKUP_PACKAGES_ROOT;

    expect(getRegistryArtifactBackupSettings()).toEqual({
      endpoint: "https://account-id.r2.cloudflarestorage.com",
      bucket: "clawhub-registry-backup",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      region: "auto",
      skillsRoot: "skills",
      packagesRoot: "packages",
    });
  });

  it("builds versioned skill backup paths and restore metadata", () => {
    const manifest = buildSkillVersionBackupManifest({
      root: "skills",
      ownerHandle: "OpenClaw Team",
      skillId: "skills:demo" as Id<"skills">,
      versionId: "skillVersions:demo-1" as Id<"skillVersions">,
      slug: "demo-skill",
      displayName: "Demo Skill",
      version: "1.2.3",
      publishedAt: 1_700_000_000_000,
      files: [
        {
          path: "SKILL.md",
          size: 42,
          storageId: "storage:skill" as Id<"_storage">,
          sha256: "sha256:skill",
          contentType: "text/markdown",
        },
      ],
    });

    expect(manifest).toMatchObject({
      skillRoot: "skills/openclaw-team/demo-skill",
      versionRoot: "skills/openclaw-team/demo-skill/1%2E2%2E3",
      indexPath: "skills/openclaw-team/demo-skill/_index.json",
      metaPath: "skills/openclaw-team/demo-skill/1%2E2%2E3/_meta.json",
      fileObjects: [
        {
          key: "skills/openclaw-team/demo-skill/1%2E2%2E3/SKILL.md",
          path: "SKILL.md",
          sha256: "sha256:skill",
          contentType: "text/markdown",
        },
      ],
      meta: {
        kind: "skillVersion",
        owner: "openclaw-team",
        slug: "demo-skill",
        displayName: "Demo Skill",
        version: "1.2.3",
        restore: {
          skillId: "skills:demo",
          versionId: "skillVersions:demo-1",
        },
      },
    });
  });

  it("rejects unsafe skill file paths before writing backup object keys", () => {
    expect(() =>
      buildSkillVersionBackupManifest({
        root: "skills",
        ownerHandle: "OpenClaw Team",
        versionId: "skillVersions:demo-1" as Id<"skillVersions">,
        slug: "demo-skill",
        displayName: "Demo Skill",
        version: "1.2.3",
        publishedAt: 1_700_000_000_000,
        files: [
          {
            path: "../SKILL.md",
            size: 42,
            storageId: "storage:skill" as Id<"_storage">,
            sha256: "sha256:skill",
          },
        ],
      }),
    ).toThrow("Invalid skill backup file path");
  });

  it("builds package release backup paths and restore metadata", () => {
    const manifest = buildPackageReleaseBackupManifest({
      root: "packages",
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
      files: [{ path: "package.json", size: 10, sha256: "sha256:package-json" }],
    });

    expect(manifest).toMatchObject({
      packageRoot: "packages/openclaw-team/%40openclaw%2Fdemo-plugin",
      releaseRoot: "packages/openclaw-team/%40openclaw%2Fdemo-plugin/1%2E2%2E3",
      artifactPath:
        "packages/openclaw-team/%40openclaw%2Fdemo-plugin/1%2E2%2E3/demo-plugin-1.2.3.tgz",
      metaPath: "packages/openclaw-team/%40openclaw%2Fdemo-plugin/1%2E2%2E3/_meta.json",
      indexPath: "packages/openclaw-team/%40openclaw%2Fdemo-plugin/_index.json",
      meta: {
        kind: "packageRelease",
        restore: {
          packageId: "packages:demo",
          releaseId: "packageReleases:demo-1",
        },
        artifact: {
          path: "demo-plugin-1.2.3.tgz",
          sha256: "sha256:artifact",
          size: 42,
          format: "tgz",
          npmIntegrity: "sha512-demo",
          npmShasum: "abc123",
        },
      },
    });
  });

  it("rejects unsafe package artifact filenames before writing backup object keys", () => {
    expect(() =>
      buildPackageReleaseBackupManifest({
        root: "packages",
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
        artifactFileName: "../evil.tgz",
        artifactSha256: "sha256:artifact",
        artifactSize: 42,
        artifactFormat: "tgz",
        files: [],
      }),
    ).toThrow("Invalid package backup artifact filename");
  });

  it("keeps skill index latest pointers on the greatest semver version without an explicit latest", () => {
    const backport = buildSkillVersionBackupManifest({
      root: "skills",
      ownerHandle: "OpenClaw Team",
      versionId: "skillVersions:demo-1" as Id<"skillVersions">,
      slug: "demo-skill",
      displayName: "Demo Skill",
      version: "1.0.0",
      publishedAt: 1_900_000_000_000,
      files: [],
    });

    const index = __registryArtifactBackupTestInternals.buildSkillIndexFile(backport, {
      kind: "skill",
      owner: "openclaw-team",
      slug: "demo-skill",
      displayName: "Demo Skill",
      latest: {
        version: "2.0.0",
        publishedAt: 1_800_000_000_000,
        versionId: "skillVersions:demo-2" as Id<"skillVersions">,
        path: "skills/openclaw-team/demo-skill/2%2E0%2E0/_meta.json",
      },
      versions: [],
    });

    expect(index.latest.version).toBe("2.0.0");
    expect(index.versions.map((version) => version.version)).toEqual(["2.0.0", "1.0.0"]);
  });

  it("preserves explicit skill latest pointers after a rollback", () => {
    const rolledBackLatest = buildSkillVersionBackupManifest({
      root: "skills",
      ownerHandle: "OpenClaw Team",
      versionId: "skillVersions:demo-1" as Id<"skillVersions">,
      slug: "demo-skill",
      displayName: "Demo Skill",
      version: "1.0.0",
      isLatest: true,
      publishedAt: 1_700_000_000_000,
      files: [],
    });

    const index = __registryArtifactBackupTestInternals.buildSkillIndexFile(rolledBackLatest, {
      kind: "skill",
      owner: "openclaw-team",
      slug: "demo-skill",
      displayName: "Demo Skill",
      latest: {
        version: "2.0.0",
        isLatest: true,
        publishedAt: 1_800_000_000_000,
        versionId: "skillVersions:demo-2" as Id<"skillVersions">,
        path: "skills/openclaw-team/demo-skill/2%2E0%2E0/_meta.json",
      },
      versions: [],
    });

    expect(index.latest).toMatchObject({
      version: "1.0.0",
      isLatest: true,
      versionId: "skillVersions:demo-1",
    });
    expect(index.versions.find((version) => version.version === "2.0.0")?.isLatest).toBe(false);
  });

  it("keeps package index latest pointers on explicit latest release markers", () => {
    const backport = buildPackageReleaseBackupManifest({
      root: "packages",
      ownerHandle: "OpenClaw Team",
      packageId: "packages:demo" as Id<"packages">,
      releaseId: "packageReleases:demo-1" as Id<"packageReleases">,
      packageName: "@openclaw/demo-plugin",
      normalizedName: "@openclaw/demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "1.0.0",
      isLatest: false,
      publishedAt: 1_900_000_000_000,
      artifactKind: "npm-pack",
      artifactSha256: "sha256:artifact",
      artifactSize: 42,
      artifactFormat: "tgz",
      files: [],
    });

    const index = __registryArtifactBackupTestInternals.buildPackageIndexFile(backport, {
      kind: "package",
      owner: "openclaw-team",
      packageName: "@openclaw/demo-plugin",
      normalizedName: "@openclaw/demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      latest: {
        version: "2.0.0",
        isLatest: true,
        publishedAt: 1_800_000_000_000,
        packageId: "packages:demo" as Id<"packages">,
        releaseId: "packageReleases:demo-2" as Id<"packageReleases">,
        path: "packages/openclaw-team/%40openclaw%2Fdemo-plugin/2%2E0%2E0/_meta.json",
      },
      versions: [],
    });

    expect(index.latest).toMatchObject({
      version: "2.0.0",
      isLatest: true,
      releaseId: "packageReleases:demo-2",
    });
  });

  it("keeps full version catalogs in skill and package indexes", () => {
    const skillBackup = buildSkillVersionBackupManifest({
      root: "skills",
      ownerHandle: "OpenClaw Team",
      versionId: "skillVersions:demo-new" as Id<"skillVersions">,
      slug: "demo-skill",
      displayName: "Demo Skill",
      version: "1001.0.0",
      publishedAt: 1_800_000_001_000,
      files: [],
    });
    const packageBackup = buildPackageReleaseBackupManifest({
      root: "packages",
      ownerHandle: "OpenClaw Team",
      packageId: "packages:demo" as Id<"packages">,
      releaseId: "packageReleases:demo-new" as Id<"packageReleases">,
      packageName: "@openclaw/demo-plugin",
      normalizedName: "@openclaw/demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "1001.0.0",
      publishedAt: 1_800_000_001_000,
      files: [],
    });
    const existingSkillVersions = Array.from({ length: 1001 }, (_, index) => ({
      version: `${index}.0.0`,
      publishedAt: 1_800_000_000_000 - index,
      versionId: `skillVersions:demo-${index}` as Id<"skillVersions">,
      path: `skills/openclaw-team/demo-skill/${index}%2E0%2E0/_meta.json`,
    }));
    const existingPackageVersions = Array.from({ length: 1001 }, (_, index) => ({
      version: `${index}.0.0`,
      publishedAt: 1_800_000_000_000 - index,
      packageId: "packages:demo" as Id<"packages">,
      releaseId: `packageReleases:demo-${index}` as Id<"packageReleases">,
      path: `packages/openclaw-team/%40openclaw%2Fdemo-plugin/${index}%2E0%2E0/_meta.json`,
    }));

    const skillIndex = __registryArtifactBackupTestInternals.buildSkillIndexFile(skillBackup, {
      kind: "skill",
      owner: "openclaw-team",
      slug: "demo-skill",
      displayName: "Demo Skill",
      latest: existingSkillVersions[0]!,
      versions: existingSkillVersions,
    });
    const packageIndex = __registryArtifactBackupTestInternals.buildPackageIndexFile(
      packageBackup,
      {
        kind: "package",
        owner: "openclaw-team",
        packageName: "@openclaw/demo-plugin",
        normalizedName: "@openclaw/demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        latest: existingPackageVersions[0]!,
        versions: existingPackageVersions,
      },
    );

    expect(skillIndex.versions).toHaveLength(1002);
    expect(packageIndex.versions).toHaveLength(1002);
  });

  it("uses lossless path encoding to avoid package and version collisions", () => {
    expect(__registryArtifactBackupTestInternals.encodeBackupPathSegment("@openclaw/demo")).toBe(
      "%40openclaw%2Fdemo",
    );
    expect(__registryArtifactBackupTestInternals.encodeBackupPathSegment("foo.bar")).toBe(
      "foo%2Ebar",
    );
    expect(__registryArtifactBackupTestInternals.encodeBackupPathSegment("foo_bar")).toBe(
      "foo_bar",
    );
  });

  it("preserves valid owner handle punctuation in backup paths", () => {
    const dotted = buildSkillVersionBackupManifest({
      root: "skills",
      ownerHandle: "foo.bar",
      versionId: "skillVersions:dotted" as Id<"skillVersions">,
      slug: "demo-skill",
      displayName: "Demo Skill",
      version: "1.0.0",
      publishedAt: 1_700_000_000_000,
      files: [],
    });
    const underscored = buildSkillVersionBackupManifest({
      root: "skills",
      ownerHandle: "foo_bar",
      versionId: "skillVersions:underscored" as Id<"skillVersions">,
      slug: "demo-skill",
      displayName: "Demo Skill",
      version: "1.0.0",
      publishedAt: 1_700_000_000_000,
      files: [],
    });
    const dashed = buildSkillVersionBackupManifest({
      root: "skills",
      ownerHandle: "foo-bar",
      versionId: "skillVersions:dashed" as Id<"skillVersions">,
      slug: "demo-skill",
      displayName: "Demo Skill",
      version: "1.0.0",
      publishedAt: 1_700_000_000_000,
      files: [],
    });

    expect([dotted.skillRoot, underscored.skillRoot, dashed.skillRoot]).toEqual([
      "skills/foo.bar/demo-skill",
      "skills/foo_bar/demo-skill",
      "skills/foo-bar/demo-skill",
    ]);
  });

  it("reads skill indexes and object bytes from object storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        const key = objectKey(String(url));
        if (init?.method === "GET" && key === "skills/openclaw-team/demo-skill/_index.json") {
          return response(
            200,
            JSON.stringify({
              kind: "skill",
              owner: "openclaw-team",
              slug: "demo-skill",
              displayName: "Demo Skill",
              latest: {
                version: "1.2.3",
                publishedAt: 1_700_000_000_000,
                path: "skills/openclaw-team/demo-skill/1%2E2%2E3/_meta.json",
              },
              versions: [],
            }),
          );
        }
        if (
          init?.method === "GET" &&
          key === "skills/openclaw-team/demo-skill/1%2E2%2E3/SKILL.md"
        ) {
          return response(200, "hello skill");
        }
        return response(404, "");
      }),
    );

    const index = await fetchSkillBackupIndex(makeContext(), "OpenClaw Team", "demo-skill");
    const bytes = await readRegistryArtifactBackupObject(
      makeContext(),
      "skills/openclaw-team/demo-skill/1%2E2%2E3/SKILL.md",
    );

    expect(index?.latest.version).toBe("1.2.3");
    expect(Buffer.from(bytes!).toString("utf8")).toBe("hello skill");
  });

  it("writes skill files, version metadata, and the skill index to object storage", async () => {
    const calls: Array<{ method: string; url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = await requestBodyText(init?.body);
        calls.push({ method, url: String(url), body });
        if (method === "GET") return response(404, "");
        return response(200, "");
      }),
    );

    await backupSkillVersionToObjectStorage(
      makeStorageCtx({ "storage:skill": "hello skill" }) as never,
      {
        root: "skills",
        ownerHandle: "OpenClaw Team",
        versionId: "skillVersions:demo-1" as Id<"skillVersions">,
        slug: "demo-skill",
        displayName: "Demo Skill",
        version: "1.2.3",
        publishedAt: 1_700_000_000_000,
        files: [
          {
            path: "SKILL.md",
            size: 11,
            storageId: "storage:skill" as Id<"_storage">,
            sha256: "sha256:skill",
            contentType: "text/markdown",
          },
        ],
      },
      makeContext(),
    );

    expect(calls.map((call) => [call.method, objectKey(call.url)])).toEqual([
      ["PUT", "skills/openclaw-team/demo-skill/1%2E2%2E3/SKILL.md"],
      ["PUT", "skills/openclaw-team/demo-skill/1%2E2%2E3/_meta.json"],
      ["GET", "skills/openclaw-team/demo-skill/_index.json"],
      ["PUT", "skills/openclaw-team/demo-skill/_index.json"],
    ]);
    expect(JSON.parse(calls[1].body)).toMatchObject({
      kind: "skillVersion",
      version: "1.2.3",
      metadata: { files: [{ path: "SKILL.md", sha256: "sha256:skill" }] },
    });
    expect(JSON.parse(calls[3].body)).toMatchObject({
      kind: "skill",
      latest: { version: "1.2.3" },
      versions: [{ version: "1.2.3" }],
    });
  });

  it("retries skill index writes when another backup updates the index first", async () => {
    const calls: Array<{ method: string; url: string; body: string; ifMatch?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const key = objectKey(String(url));
        const body = await requestBodyText(init?.body);
        calls.push({
          method,
          url: String(url),
          body,
          ifMatch: headerValue(init?.headers, "if-match"),
        });

        if (method === "GET" && key === "skills/openclaw-team/demo-skill/_index.json") {
          const indexGetCount = calls.filter(
            (call) =>
              call.method === "GET" &&
              objectKey(call.url) === "skills/openclaw-team/demo-skill/_index.json",
          ).length;
          if (indexGetCount === 1) {
            return response(
              200,
              JSON.stringify({
                kind: "skill",
                owner: "openclaw-team",
                slug: "demo-skill",
                displayName: "Demo Skill",
                latest: {
                  version: "1.0.0",
                  publishedAt: 1_600_000_000_000,
                  path: "skills/openclaw-team/demo-skill/1%2E0%2E0/_meta.json",
                },
                versions: [
                  {
                    version: "1.0.0",
                    publishedAt: 1_600_000_000_000,
                    path: "skills/openclaw-team/demo-skill/1%2E0%2E0/_meta.json",
                  },
                ],
              }),
              { etag: '"old-index"' },
            );
          }
          return response(
            200,
            JSON.stringify({
              kind: "skill",
              owner: "openclaw-team",
              slug: "demo-skill",
              displayName: "Demo Skill",
              latest: {
                version: "2.0.0",
                publishedAt: 1_800_000_000_000,
                path: "skills/openclaw-team/demo-skill/2%2E0%2E0/_meta.json",
              },
              versions: [
                {
                  version: "2.0.0",
                  publishedAt: 1_800_000_000_000,
                  path: "skills/openclaw-team/demo-skill/2%2E0%2E0/_meta.json",
                },
                {
                  version: "1.0.0",
                  publishedAt: 1_600_000_000_000,
                  path: "skills/openclaw-team/demo-skill/1%2E0%2E0/_meta.json",
                },
              ],
            }),
            { etag: '"new-index"' },
          );
        }

        if (method === "PUT" && key === "skills/openclaw-team/demo-skill/_index.json") {
          return headerValue(init?.headers, "if-match") === '"old-index"'
            ? response(412, "precondition failed")
            : response(200, "");
        }

        return response(200, "");
      }),
    );

    await backupSkillVersionToObjectStorage(
      makeStorageCtx({ "storage:skill": "hello skill" }) as never,
      {
        root: "skills",
        ownerHandle: "OpenClaw Team",
        versionId: "skillVersions:demo-1.2" as Id<"skillVersions">,
        slug: "demo-skill",
        displayName: "Demo Skill",
        version: "1.2.3",
        publishedAt: 1_700_000_000_000,
        files: [
          {
            path: "SKILL.md",
            size: 11,
            storageId: "storage:skill" as Id<"_storage">,
            sha256: "sha256:skill",
            contentType: "text/markdown",
          },
        ],
      },
      makeContext(),
    );

    const indexPuts = calls.filter(
      (call) =>
        call.method === "PUT" &&
        objectKey(call.url) === "skills/openclaw-team/demo-skill/_index.json",
    );
    expect(indexPuts.map((call) => call.ifMatch)).toEqual(['"old-index"', '"new-index"']);
    expect(JSON.parse(indexPuts[1].body)).toMatchObject({
      latest: { version: "2.0.0" },
      versions: [{ version: "2.0.0" }, { version: "1.2.3" }, { version: "1.0.0" }],
    });
  });

  it("writes package artifacts, version metadata, and the package index to object storage", async () => {
    const calls: Array<{ method: string; url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = await requestBodyText(init?.body);
        calls.push({ method, url: String(url), body });
        if (method === "GET") return response(404, "");
        return response(200, "");
      }),
    );

    await backupPackageReleaseToObjectStorage(
      makeStorageCtx({ "storage:artifact": "tgz bytes" }) as never,
      {
        root: "packages",
        ownerHandle: "OpenClaw Team",
        packageId: "packages:demo" as Id<"packages">,
        releaseId: "packageReleases:demo-1" as Id<"packageReleases">,
        packageName: "@openclaw/demo-plugin",
        normalizedName: "@openclaw/demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.2.3",
        publishedAt: 1_700_000_000_000,
        artifactStorageId: "storage:artifact" as Id<"_storage">,
        artifactFileName: "demo-plugin-1.2.3.tgz",
        artifactSha256: "sha256:artifact",
        artifactSize: 9,
        files: [],
      },
      makeContext(),
    );

    expect(calls.map((call) => [call.method, objectKey(call.url)])).toEqual([
      ["PUT", "packages/openclaw-team/%40openclaw%2Fdemo-plugin/1%2E2%2E3/demo-plugin-1.2.3.tgz"],
      ["PUT", "packages/openclaw-team/%40openclaw%2Fdemo-plugin/1%2E2%2E3/_meta.json"],
      ["GET", "packages/openclaw-team/%40openclaw%2Fdemo-plugin/_index.json"],
      ["PUT", "packages/openclaw-team/%40openclaw%2Fdemo-plugin/_index.json"],
    ]);
    expect(JSON.parse(calls[1].body)).toMatchObject({
      kind: "packageRelease",
      artifact: { path: "demo-plugin-1.2.3.tgz", sha256: "sha256:artifact" },
    });
    expect(JSON.parse(calls[3].body)).toMatchObject({
      kind: "package",
      latest: { version: "1.2.3", releaseId: "packageReleases:demo-1" },
    });
  });
});

function setEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function makeContext() {
  return {
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "clawhub-registry-backup",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    region: "auto",
    skillsRoot: "skills",
    packagesRoot: "packages",
  };
}

function makeStorageCtx(contents: Record<string, string>) {
  return {
    storage: {
      get: async (id: Id<"_storage">) => {
        const value = contents[id];
        return value === undefined ? null : new Blob([value]);
      },
    },
  };
}

function response(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => {
      const buffer = Buffer.from(body);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

function objectKey(url: string) {
  const parsed = new URL(url);
  const prefix = "/clawhub-registry-backup/";
  return decodeURIComponent(parsed.pathname.slice(prefix.length));
}

async function requestBodyText(body: BodyInit | null | undefined) {
  if (!body) return "";
  return Buffer.from(await new Response(body).arrayBuffer()).toString("utf8");
}

function headerValue(headers: HeadersInit | undefined, name: string) {
  return new Headers(headers).get(name) ?? undefined;
}
