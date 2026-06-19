import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  __registryArtifactBackupTestInternals,
  backupPackageReleaseToObjectStorage,
  backupSkillVersionToObjectStorage,
  buildPackageReleaseBackupManifest,
  buildSkillVersionBackupManifest,
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
    skillFileUploadConcurrency: process.env.REGISTRY_BACKUP_SKILL_FILE_UPLOAD_CONCURRENCY,
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
    setEnv("REGISTRY_BACKUP_SKILL_FILE_UPLOAD_CONCURRENCY", originalEnv.skillFileUploadConcurrency);
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

  it("uses strict AWS URI encoding for object keys before signing R2 requests", () => {
    expect(
      __registryArtifactBackupTestInternals.encodeObjectKey(
        "skills/smartpeopleconnected/token-optimizer/1%2E0%2E0/infomaterial/4_github_publish_Alles ist fertig!.txt",
      ),
    ).toBe(
      "skills/smartpeopleconnected/token-optimizer/1%252E0%252E0/infomaterial/4_github_publish_Alles%20ist%20fertig%21.txt",
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

  it("reads object bytes from object storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        const key = objectKey(String(url));
        if (
          init?.method === "GET" &&
          key === "skills/openclaw-team/demo-skill/1%2E2%2E3/SKILL.md"
        ) {
          return response(200, "hello skill");
        }
        return response(404, "");
      }),
    );

    const bytes = await readRegistryArtifactBackupObject(
      makeContext(),
      "skills/openclaw-team/demo-skill/1%2E2%2E3/SKILL.md",
    );

    expect(Buffer.from(bytes!).toString("utf8")).toBe("hello skill");
  });

  it("writes skill files and version metadata to object storage", async () => {
    const calls: Array<{ method: string; url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = await requestBodyText(init?.body);
        calls.push({ method, url: String(url), body });
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
    ]);
    expect(JSON.parse(calls[1].body)).toMatchObject({
      kind: "skillVersion",
      version: "1.2.3",
      metadata: { files: [{ path: "SKILL.md", sha256: "sha256:skill" }] },
    });
  });

  it("uploads skill files with bounded parallelism before writing version metadata", async () => {
    process.env.REGISTRY_BACKUP_SKILL_FILE_UPLOAD_CONCURRENCY = "3";

    const calls: Array<{ method: string; key: string }> = [];
    let activeFileUploads = 0;
    let maxActiveFileUploads = 0;
    let completedFileUploads = 0;
    let completedWhenMetaStarted = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        const key = objectKey(String(url));
        calls.push({ method: init?.method ?? "GET", key });
        if (!key.endsWith("/_meta.json")) {
          activeFileUploads += 1;
          maxActiveFileUploads = Math.max(maxActiveFileUploads, activeFileUploads);
          await new Promise((resolve) => setTimeout(resolve, 20));
          activeFileUploads -= 1;
          completedFileUploads += 1;
        } else {
          completedWhenMetaStarted = completedFileUploads;
        }
        return response(200, "");
      }),
    );

    const files = Array.from({ length: 6 }, (_, index) => ({
      path: `file-${index}.txt`,
      size: 6,
      storageId: `storage:file-${index}` as Id<"_storage">,
      sha256: `sha256:file-${index}`,
      contentType: "text/plain",
    }));

    await backupSkillVersionToObjectStorage(
      makeStorageCtx(
        Object.fromEntries(files.map((file) => [file.storageId, `body-${file.path}`])),
      ) as never,
      {
        root: "skills",
        ownerHandle: "OpenClaw Team",
        versionId: "skillVersions:demo-1" as Id<"skillVersions">,
        slug: "demo-skill",
        displayName: "Demo Skill",
        version: "1.2.3",
        publishedAt: 1_700_000_000_000,
        files,
      },
      makeContext(),
    );

    expect(maxActiveFileUploads).toBe(3);
    expect(completedWhenMetaStarted).toBe(6);
    expect(calls.at(-1)).toEqual({
      method: "PUT",
      key: "skills/openclaw-team/demo-skill/1%2E2%2E3/_meta.json",
    });
  });

  it("writes package artifacts and version metadata to object storage", async () => {
    const calls: Array<{ method: string; url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = await requestBodyText(init?.body);
        calls.push({ method, url: String(url), body });
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
    ]);
    expect(JSON.parse(calls[1].body)).toMatchObject({
      kind: "packageRelease",
      artifact: { path: "demo-plugin-1.2.3.tgz", sha256: "sha256:artifact" },
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
