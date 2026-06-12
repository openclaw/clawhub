import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreSkillFromBackup } from "./registryArtifactRestore";

const registryBackupMocks = vi.hoisted(() => ({
  fetchSkillBackupIndex: vi.fn(),
  fetchSkillVersionBackupMeta: vi.fn(),
  getRegistryArtifactBackupContext: vi.fn(),
  isRegistryArtifactBackupConfigured: vi.fn(),
  normalizeOwner: vi.fn((value: string) => value.toLowerCase()),
  readRegistryArtifactBackupObject: vi.fn(),
}));

const skillPublishMocks = vi.hoisted(() => ({
  publishVersionForUser: vi.fn(),
}));

vi.mock("./lib/registryArtifactBackup", () => registryBackupMocks);
vi.mock("./lib/skillPublish", () => skillPublishMocks);

const restoreHandler = (restoreSkillFromBackup as unknown as { _handler: Function })._handler;

describe("restoreSkillFromBackup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    registryBackupMocks.normalizeOwner.mockImplementation((value: string) => value.toLowerCase());
    registryBackupMocks.getRegistryArtifactBackupContext.mockReturnValue({
      endpoint: "https://account.r2.cloudflarestorage.com",
      bucket: "clawhub-registry-backup",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      region: "auto",
      skillsRoot: "skills",
      packagesRoot: "packages",
    });
    registryBackupMocks.isRegistryArtifactBackupConfigured.mockReturnValue(true);
  });

  it("blocks restore when the current slug row is not public", async () => {
    const result = await restoreHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({ _id: "users:admin", role: "admin" })
          .mockResolvedValueOnce({
            _id: "skills:hidden",
            ownerUserId: "users:owner",
            slug: "demo-skill",
            softDeletedAt: undefined,
            moderationStatus: "hidden",
          }),
      } as never,
      {
        actorUserId: "users:admin",
        ownerHandle: "alice",
        ownerUserId: "users:owner",
        slug: "demo-skill",
      },
    );

    expect(result).toEqual({
      slug: "demo-skill",
      status: "error",
      detail: "Existing skill is not public; restore blocked",
    });
    expect(registryBackupMocks.fetchSkillBackupIndex).not.toHaveBeenCalled();
  });

  it("reactivates the same owner's soft-deleted skill row without republishing a duplicate version", async () => {
    registryBackupMocks.fetchSkillBackupIndex.mockResolvedValueOnce({
      latest: { version: "1.0.0" },
    });
    registryBackupMocks.fetchSkillVersionBackupMeta.mockResolvedValueOnce({
      version: "1.0.0",
      displayName: "Demo Skill",
      metadata: {
        files: [
          {
            path: "SKILL.md",
            size: 5,
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          },
        ],
      },
    });
    registryBackupMocks.readRegistryArtifactBackupObject.mockResolvedValueOnce(
      new TextEncoder().encode("hello"),
    );
    const storage = { store: vi.fn().mockResolvedValue("storage:restored") };
    const runMutation = vi.fn();

    const result = await restoreHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({ _id: "users:admin", role: "admin" })
          .mockResolvedValueOnce({
            _id: "skills:deleted",
            ownerUserId: "users:owner",
            slug: "demo-skill",
            softDeletedAt: 123,
            moderationStatus: "active",
          })
          .mockResolvedValueOnce({
            _id: "skillVersions:existing",
            skillId: "skills:deleted",
            version: "1.0.0",
            softDeletedAt: undefined,
          }),
        runMutation,
        storage,
      } as never,
      {
        actorUserId: "users:admin",
        ownerHandle: "alice",
        ownerUserId: "users:owner",
        slug: "demo-skill",
      },
    );

    expect(result).toEqual({ slug: "demo-skill", status: "restored" });
    expect(skillPublishMocks.publishVersionForUser).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        userId: "users:admin",
        slug: "demo-skill",
        deleted: false,
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:admin",
        skillId: "skills:deleted",
        versionId: "skillVersions:existing",
        files: [
          expect.objectContaining({
            path: "SKILL.md",
            size: 5,
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            storageId: "storage:restored",
          }),
        ],
      }),
    );
  });

  it("fails restore when a manifest file is missing from backup storage", async () => {
    registryBackupMocks.fetchSkillBackupIndex.mockResolvedValueOnce({
      latest: { version: "1.0.0" },
    });
    registryBackupMocks.fetchSkillVersionBackupMeta.mockResolvedValueOnce({
      version: "1.0.0",
      displayName: "Demo Skill",
      metadata: {
        files: [{ path: "SKILL.md", size: 5, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e" }],
      },
    });
    registryBackupMocks.readRegistryArtifactBackupObject.mockResolvedValueOnce(null);
    const storage = { store: vi.fn() };

    const result = await restoreHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({ _id: "users:admin", role: "admin" })
          .mockResolvedValueOnce(null),
        storage,
      } as never,
      {
        actorUserId: "users:admin",
        ownerHandle: "alice",
        ownerUserId: "users:owner",
        slug: "demo-skill",
      },
    );

    expect(result).toEqual({
      slug: "demo-skill",
      status: "error",
      detail: "Backup missing file SKILL.md",
    });
    expect(storage.store).not.toHaveBeenCalled();
    expect(skillPublishMocks.publishVersionForUser).not.toHaveBeenCalled();
  });

  it("fails restore when a manifest file checksum does not match backup storage", async () => {
    registryBackupMocks.fetchSkillBackupIndex.mockResolvedValueOnce({
      latest: { version: "1.0.0" },
    });
    registryBackupMocks.fetchSkillVersionBackupMeta.mockResolvedValueOnce({
      version: "1.0.0",
      displayName: "Demo Skill",
      metadata: {
        files: [{ path: "SKILL.md", size: 5, sha256: "wrong-sha256" }],
      },
    });
    registryBackupMocks.readRegistryArtifactBackupObject.mockResolvedValueOnce(
      new TextEncoder().encode("hello"),
    );
    const storage = { store: vi.fn() };

    const result = await restoreHandler(
      {
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({ _id: "users:admin", role: "admin" })
          .mockResolvedValueOnce(null),
        storage,
      } as never,
      {
        actorUserId: "users:admin",
        ownerHandle: "alice",
        ownerUserId: "users:owner",
        slug: "demo-skill",
      },
    );

    expect(result).toEqual({
      slug: "demo-skill",
      status: "error",
      detail: "Backup file checksum mismatch for SKILL.md",
    });
    expect(storage.store).not.toHaveBeenCalled();
    expect(skillPublishMocks.publishVersionForUser).not.toHaveBeenCalled();
  });
});
