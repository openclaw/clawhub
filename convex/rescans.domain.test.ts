import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "./lib/access";
import {
  finalizeInProgressRescanRequestsForTarget,
  MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE,
} from "./model/rescans/policy";
import { dispatchPackageRescanInternal, requestRescan as requestPackageRescan } from "./packages";
import {
  dispatchSkillRescanInternal,
  getRescanState as getSkillRescanState,
  requestRescan as requestSkillRescan,
} from "./skills";

vi.mock("./lib/access", () => ({
  requireUser: vi.fn(),
}));

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const requestSkillRescanHandler = (
  requestSkillRescan as unknown as WrappedHandler<{ skillId: string }>
)._handler;
const requestPackageRescanHandler = (
  requestPackageRescan as unknown as WrappedHandler<{ packageId: string }>
)._handler;
const getSkillRescanStateHandler = (
  getSkillRescanState as unknown as WrappedHandler<{ skillId: string }>
)._handler;
const dispatchSkillRescanHandler = (
  dispatchSkillRescanInternal as unknown as WrappedHandler<{
    requestId: string;
    skillId: string;
    versionId: string;
  }>
)._handler;
const dispatchPackageRescanHandler = (
  dispatchPackageRescanInternal as unknown as WrappedHandler<{
    requestId: string;
    releaseId: string;
  }>
)._handler;

type RescanRequest = {
  _id: string;
  targetKind: "skill" | "plugin";
  skillId?: string;
  skillVersionId?: string;
  packageId?: string;
  packageReleaseId?: string;
  targetVersion: string;
  requestedByUserId: string;
  ownerUserId: string;
  ownerPublisherId?: string;
  status: "in_progress" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

function matches(doc: Record<string, unknown>, constraints: Record<string, unknown>) {
  return Object.entries(constraints).every(([key, value]) => doc[key] === value);
}

function createDb(options?: {
  requests?: RescanRequest[];
  userRole?: "admin" | "moderator" | "user";
  ownerPublisherId?: string;
  membershipRole?: "owner" | "admin" | "publisher";
  skillLatestVersionId?: string;
  packageLatestReleaseId?: string;
  skillSoftDeletedAt?: number;
  skillVersionSoftDeletedAt?: number;
  packageSoftDeletedAt?: number;
  packageReleaseSoftDeletedAt?: number;
}) {
  const requests = [...(options?.requests ?? [])];
  const skill = {
    _id: "skills:1",
    slug: "flagged-skill",
    ownerUserId: "users:owner",
    ownerPublisherId: options?.ownerPublisherId,
    latestVersionId: options?.skillLatestVersionId ?? "skillVersions:latest",
    softDeletedAt: options?.skillSoftDeletedAt,
  };
  const version = {
    _id: "skillVersions:latest",
    skillId: "skills:1",
    version: "1.2.3",
    softDeletedAt: options?.skillVersionSoftDeletedAt,
  };
  const pkg = {
    _id: "packages:1",
    name: "flagged-plugin",
    family: "code-plugin",
    ownerUserId: "users:owner",
    ownerPublisherId: options?.ownerPublisherId,
    latestReleaseId: options?.packageLatestReleaseId ?? "packageReleases:latest",
    softDeletedAt: options?.packageSoftDeletedAt,
  };
  const release = {
    _id: "packageReleases:latest",
    packageId: "packages:1",
    version: "2.0.0",
    softDeletedAt: options?.packageReleaseSoftDeletedAt,
  };
  const actor = {
    _id: "users:actor",
    role: options?.userRole ?? "user",
    deletedAt: undefined,
    deactivatedAt: undefined,
  };

  const db = {
    get: vi.fn(async (id: string) => {
      if (id === "skills:1") return skill;
      if (id === "skillVersions:latest") return version;
      if (id === "packages:1") return pkg;
      if (id === "packageReleases:latest") return release;
      if (id === "users:actor") return actor;
      return null;
    }),
    insert: vi.fn(async (table: string, doc: Omit<RescanRequest, "_id">) => {
      if (table !== "rescanRequests") throw new Error(`unexpected insert ${table}`);
      const inserted = {
        _id: `rescanRequests:${requests.length + 1}`,
        ...doc,
      } as RescanRequest;
      requests.push(inserted);
      return inserted._id;
    }),
    patch: vi.fn(async (id: string, patch: Partial<RescanRequest>) => {
      const request = requests.find((candidate) => candidate._id === id);
      if (request) Object.assign(request, patch);
    }),
    query: vi.fn((table: string) => {
      if (table === "publisherMembers") {
        return {
          withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
            if (name !== "by_publisher_user") throw new Error(`unexpected index ${name}`);
            const constraints: Record<string, unknown> = {};
            build(chainEq(constraints));
            return {
              unique: async () =>
                options?.membershipRole
                  ? {
                      publisherId: constraints.publisherId,
                      userId: constraints.userId,
                      role: options.membershipRole,
                    }
                  : null,
            };
          },
        };
      }
      if (table !== "rescanRequests") throw new Error(`unexpected table ${table}`);
      return {
        withIndex: (_name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
          const constraints: Record<string, unknown> = {};
          build(chainEq(constraints));
          const matched = requests
            .filter((request) =>
              matches(request as unknown as Record<string, unknown>, constraints),
            )
            .sort((a, b) => b.createdAt - a.createdAt);
          return {
            order: () => ({
              take: async (limit: number) => matched.slice(0, limit),
              first: async () => matched[0] ?? null,
            }),
          };
        },
      };
    }),
    normalizeId: vi.fn((table: string, id: string) => (id.startsWith(`${table}:`) ? id : null)),
  };

  return { db, requests };
}

function createRequest(overrides?: Partial<RescanRequest>): RescanRequest {
  return {
    _id: "rescanRequests:existing",
    targetKind: "skill",
    skillId: "skills:1",
    skillVersionId: "skillVersions:latest",
    targetVersion: "1.2.3",
    requestedByUserId: "users:owner",
    ownerUserId: "users:owner",
    status: "completed",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  vi.mocked(requireUser).mockResolvedValue({
    userId: "users:owner",
    user: { _id: "users:owner", role: "user" },
  } as never);
});

describe("rescan requests", () => {
  it("returns owner-visible state for the latest skill version", async () => {
    const { db } = createDb({
      requests: [
        createRequest({ _id: "rescanRequests:1", status: "completed", createdAt: 1 }),
        createRequest({ _id: "rescanRequests:2", status: "failed", createdAt: 2 }),
      ],
    });

    const result = await getSkillRescanStateHandler({ db } as never, {
      skillId: "skills:1",
    });

    expect(result).toMatchObject({
      targetKind: "skill",
      targetVersion: "1.2.3",
      maxRequests: MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE,
      requestCount: 2,
      remainingRequests: 1,
      canRequest: true,
    });
  });

  it("creates a skill rescan request and schedules dispatch", async () => {
    const { db, requests } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    const result = await requestSkillRescanHandler({ db, scheduler } as never, {
      skillId: "skills:1",
    });

    expect(result).toMatchObject({
      requestId: "rescanRequests:1",
      remainingRequests: 2,
    });
    expect(requests[0]).toMatchObject({
      targetKind: "skill",
      skillId: "skills:1",
      skillVersionId: "skillVersions:latest",
      status: "in_progress",
      targetVersion: "1.2.3",
    });
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        requestId: "rescanRequests:1",
        skillId: "skills:1",
        versionId: "skillVersions:latest",
      }),
    );
  });

  it("creates a plugin rescan request against the latest release", async () => {
    const { db, requests } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await requestPackageRescanHandler({ db, scheduler } as never, {
      packageId: "packages:1",
    });

    expect(requests[0]).toMatchObject({
      targetKind: "plugin",
      packageId: "packages:1",
      packageReleaseId: "packageReleases:latest",
      status: "in_progress",
      targetVersion: "2.0.0",
    });
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        requestId: "rescanRequests:1",
        releaseId: "packageReleases:latest",
      }),
    );
  });

  it("rejects duplicate in-progress requests for the same release", async () => {
    const { db } = createDb({
      requests: [createRequest({ status: "in_progress" })],
    });

    await expect(
      requestSkillRescanHandler({ db, scheduler: { runAfter: vi.fn() } } as never, {
        skillId: "skills:1",
      }),
    ).rejects.toThrow("already in progress");
  });

  it("enforces the per-release rescan cap", async () => {
    const { db } = createDb({
      requests: Array.from({ length: MAX_OWNER_RESCAN_REQUESTS_PER_RELEASE }, (_, index) =>
        createRequest({
          _id: `rescanRequests:${index}`,
          status: "completed",
          createdAt: index,
        }),
      ),
    });

    await expect(
      requestSkillRescanHandler({ db, scheduler: { runAfter: vi.fn() } } as never, {
        skillId: "skills:1",
      }),
    ).rejects.toThrow("Rescan request limit reached");
  });

  it("rejects non-owners", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    const { db } = createDb();

    await expect(
      requestSkillRescanHandler({ db, scheduler: { runAfter: vi.fn() } } as never, {
        skillId: "skills:1",
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("lets org admins request owner rescans", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    const { db } = createDb({
      ownerPublisherId: "publishers:org",
      membershipRole: "admin",
    });

    await expect(
      requestSkillRescanHandler({ db, scheduler: { runAfter: vi.fn() } } as never, {
        skillId: "skills:1",
      }),
    ).resolves.toMatchObject({ requestId: "rescanRequests:1" });
  });

  it("rejects publisher-only org members", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    const { db } = createDb({
      ownerPublisherId: "publishers:org",
      membershipRole: "publisher",
    });

    await expect(
      requestSkillRescanHandler({ db, scheduler: { runAfter: vi.fn() } } as never, {
        skillId: "skills:1",
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("lets admins request owner rescans", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const { db } = createDb();

    await expect(
      requestSkillRescanHandler({ db, scheduler: { runAfter: vi.fn() } } as never, {
        skillId: "skills:1",
      }),
    ).resolves.toMatchObject({ requestId: "rescanRequests:1" });
  });

  it("rejects missing or soft-deleted skill targets", async () => {
    const softDeletedSkill = createDb({ skillSoftDeletedAt: 123 });
    await expect(
      requestSkillRescanHandler(
        { db: softDeletedSkill.db, scheduler: { runAfter: vi.fn() } } as never,
        { skillId: "skills:1" },
      ),
    ).rejects.toThrow("Skill not found");

    const softDeletedVersion = createDb({ skillVersionSoftDeletedAt: 123 });
    await expect(
      requestSkillRescanHandler(
        { db: softDeletedVersion.db, scheduler: { runAfter: vi.fn() } } as never,
        { skillId: "skills:1" },
      ),
    ).rejects.toThrow("Latest skill version not found");
  });

  it("rejects missing or soft-deleted plugin targets", async () => {
    const softDeletedPackage = createDb({ packageSoftDeletedAt: 123 });
    await expect(
      requestPackageRescanHandler(
        { db: softDeletedPackage.db, scheduler: { runAfter: vi.fn() } } as never,
        { packageId: "packages:1" },
      ),
    ).rejects.toThrow("Plugin not found");

    const softDeletedRelease = createDb({ packageReleaseSoftDeletedAt: 123 });
    await expect(
      requestPackageRescanHandler(
        { db: softDeletedRelease.db, scheduler: { runAfter: vi.fn() } } as never,
        { packageId: "packages:1" },
      ),
    ).rejects.toThrow("Latest plugin release not found");
  });

  it("dispatches skill rescans through each existing scanner without completing early", async () => {
    const runAction = vi.fn(async () => undefined);
    const runMutation = vi.fn(async () => undefined);

    await dispatchSkillRescanHandler({ runAction, runMutation } as never, {
      requestId: "rescanRequests:1",
      skillId: "skills:1",
      versionId: "skillVersions:latest",
    });

    expect(runAction).toHaveBeenCalledTimes(3);
    expect(runAction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ skillId: "skills:1", versionId: "skillVersions:latest" }),
    );
    expect(runAction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ versionId: "skillVersions:latest" }),
    );
    expect(runAction).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({ versionId: "skillVersions:latest" }),
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("dispatches plugin rescans through each existing scanner without completing early", async () => {
    const runAction = vi.fn(async () => undefined);
    const runMutation = vi.fn(async () => undefined);

    await dispatchPackageRescanHandler({ runAction, runMutation } as never, {
      requestId: "rescanRequests:1",
      releaseId: "packageReleases:latest",
    });

    expect(runAction).toHaveBeenCalledTimes(3);
    expect(runAction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ releaseId: "packageReleases:latest" }),
    );
    expect(runAction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ releaseId: "packageReleases:latest" }),
    );
    expect(runAction).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({ releaseId: "packageReleases:latest" }),
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("completes in-progress rescans when all scanner results are fresh", async () => {
    const { db, requests } = createDb({
      requests: [createRequest({ status: "in_progress", createdAt: 100 })],
    });

    await finalizeInProgressRescanRequestsForTarget(
      { db } as never,
      { kind: "skill", artifactId: "skillVersions:latest" as never },
      {
        staticScan: { status: "clean", checkedAt: 101 },
        vtAnalysis: { status: "clean", checkedAt: 102 },
        llmAnalysis: { status: "benign", checkedAt: 103 },
      },
    );

    expect(requests[0]).toMatchObject({ status: "completed" });
    expect(requests[0].completedAt).toEqual(expect.any(Number));
  });

  it("keeps in-progress rescans open while VT only has old results", async () => {
    const { db, requests } = createDb({
      requests: [createRequest({ status: "in_progress", createdAt: 100 })],
    });

    await finalizeInProgressRescanRequestsForTarget(
      { db } as never,
      { kind: "skill", artifactId: "skillVersions:latest" as never },
      {
        staticScan: { status: "clean", checkedAt: 101 },
        vtAnalysis: { status: "clean", checkedAt: 99 },
        llmAnalysis: { status: "benign", checkedAt: 103 },
      },
    );

    expect(requests[0]).toMatchObject({ status: "in_progress" });
  });
});
