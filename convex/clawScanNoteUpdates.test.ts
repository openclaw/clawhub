import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "./lib/access";
import { updateLatestClawScanNoteAndRequestRescan as updatePackageClawScanNoteAndRequestRescan } from "./packages";
import { updateLatestClawScanNoteAndRequestRescan as updateSkillClawScanNoteAndRequestRescan } from "./skills";

vi.mock("./lib/access", () => ({
  requireUser: vi.fn(),
}));

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const updateSkillClawScanNoteAndRequestRescanHandler = (
  updateSkillClawScanNoteAndRequestRescan as unknown as WrappedHandler<{
    skillId: string;
    clawScanNote?: string;
  }>
)._handler;

const updatePackageClawScanNoteAndRequestRescanHandler = (
  updatePackageClawScanNoteAndRequestRescan as unknown as WrappedHandler<{
    packageId: string;
    clawScanNote?: string;
  }>
)._handler;

function createDb() {
  const auditLogs: Array<Record<string, unknown>> = [];
  const skill = {
    _id: "skills:1",
    slug: "flagged-skill",
    ownerUserId: "users:owner",
    latestVersionId: "skillVersions:latest",
    softDeletedAt: undefined,
  };
  const version = {
    _id: "skillVersions:latest",
    skillId: "skills:1",
    version: "1.2.3",
    clawScanNote: "old skill note",
    softDeletedAt: undefined,
  };
  const pkg = {
    _id: "packages:1",
    name: "flagged-plugin",
    family: "code-plugin",
    ownerUserId: "users:owner",
    latestReleaseId: "packageReleases:latest",
    softDeletedAt: undefined,
  };
  const release = {
    _id: "packageReleases:latest",
    packageId: "packages:1",
    version: "2.0.0",
    clawScanNote: "old plugin note",
    softDeletedAt: undefined,
  };

  const db = {
    get: vi.fn(async (tableOrId: string, maybeId?: string) => {
      const id = maybeId ?? tableOrId;
      if (id === "skills:1") return skill;
      if (id === "skillVersions:latest") return version;
      if (id === "packages:1") return pkg;
      if (id === "packageReleases:latest") return release;
      return null;
    }),
    insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
      if (table !== "auditLogs") throw new Error(`unexpected insert ${table}`);
      auditLogs.push(doc);
      return `auditLogs:${auditLogs.length}`;
    }),
    patch: vi.fn(
      async (
        tableOrId: string,
        idOrPatch: string | Record<string, unknown>,
        maybePatch?: Record<string, unknown>,
      ) => {
        const id = maybePatch ? (idOrPatch as string) : tableOrId;
        const patch = maybePatch ?? (idOrPatch as Record<string, unknown>);
        if (id === "skillVersions:latest") Object.assign(version, patch);
        if (id === "packageReleases:latest") Object.assign(release, patch);
      },
    ),
    query: vi.fn((table: string) => {
      throw new Error(`unexpected table ${table}`);
    }),
    normalizeId: vi.fn((table: string, id: string) => (id.startsWith(`${table}:`) ? id : null)),
    system: {},
  };

  return { db, auditLogs, version, release };
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  vi.mocked(requireUser).mockResolvedValue({
    userId: "users:owner",
    user: { _id: "users:owner", role: "user" },
  } as never);
});

describe("publisher ClawScan note updates", () => {
  it("updates a latest skill publisher note, writes audit metadata, and schedules ClawScan", async () => {
    const { db, auditLogs, version } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await updateSkillClawScanNoteAndRequestRescanHandler({ db, scheduler } as never, {
      skillId: "skills:1",
      clawScanNote: "New context for the scanner.",
    });

    expect(version).toMatchObject({
      clawScanNote: "New context for the scanner.",
      clawScanNoteUpdatedAt: expect.any(Number),
    });
    expect(auditLogs[0]).toMatchObject({
      action: "skill.clawscan_note.update",
      targetType: "skillVersion",
      targetId: "skillVersions:latest",
      metadata: expect.objectContaining({
        hadPreviousNote: true,
        hasNextNote: true,
        nextLength: 28,
      }),
    });
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        versionId: "skillVersions:latest",
      }),
    );
  });

  it("clears a latest skill publisher note while preserving the update timestamp", async () => {
    const { db, auditLogs, version } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await updateSkillClawScanNoteAndRequestRescanHandler({ db, scheduler } as never, {
      skillId: "skills:1",
      clawScanNote: "   ",
    });

    expect(version).toMatchObject({
      clawScanNote: "",
      clawScanNoteUpdatedAt: expect.any(Number),
    });
    expect(auditLogs[0]).toMatchObject({
      action: "skill.clawscan_note.update",
      metadata: expect.objectContaining({
        hadPreviousNote: true,
        hasNextNote: false,
        nextLength: 0,
      }),
    });
  });

  it("updates a latest plugin publisher note, writes audit metadata, and schedules ClawScan", async () => {
    const { db, auditLogs, release } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await updatePackageClawScanNoteAndRequestRescanHandler({ db, scheduler } as never, {
      packageId: "packages:1",
      clawScanNote: "Plugin native host is scoped to local files.",
    });

    expect(release).toMatchObject({
      clawScanNote: "Plugin native host is scoped to local files.",
      clawScanNoteUpdatedAt: expect.any(Number),
    });
    expect(auditLogs[0]).toMatchObject({
      action: "package.clawscan_note.update",
      targetType: "packageRelease",
      targetId: "packageReleases:latest",
      metadata: expect.objectContaining({
        hadPreviousNote: true,
        hasNextNote: true,
      }),
    });
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        releaseId: "packageReleases:latest",
      }),
    );
  });

  it("allows platform moderators to update latest skill publisher notes", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const { db, version } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await updateSkillClawScanNoteAndRequestRescanHandler({ db, scheduler } as never, {
      skillId: "skills:1",
      clawScanNote: "Moderator context.",
    });

    expect(version).toMatchObject({
      clawScanNote: "Moderator context.",
      clawScanNoteUpdatedAt: expect.any(Number),
    });
  });

  it("allows platform moderators to update latest plugin publisher notes", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const { db, release } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await updatePackageClawScanNoteAndRequestRescanHandler({ db, scheduler } as never, {
      packageId: "packages:1",
      clawScanNote: "Moderator plugin context.",
    });

    expect(release).toMatchObject({
      clawScanNote: "Moderator plugin context.",
      clawScanNoteUpdatedAt: expect.any(Number),
    });
  });
});
