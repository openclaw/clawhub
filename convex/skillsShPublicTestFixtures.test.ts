import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateControlledExternalSkill,
  deactivateControlledExternalSkill,
  prepareControlledExternalSkill,
  readControlledExternalSkill,
} from "./skillsShPublicTestFixtures";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const confirm = "manage-claw-583-external-catalog-test-fixture" as const;
const readFixture = (
  readControlledExternalSkill as unknown as WrappedHandler<{ confirm: typeof confirm }>
)._handler;
const activateFixture = (
  activateControlledExternalSkill as unknown as WrappedHandler<{ confirm: typeof confirm }>
)._handler;
const deactivateFixture = (
  deactivateControlledExternalSkill as unknown as WrappedHandler<{
    confirm: typeof confirm;
    digestId?: string;
    sourceSnapshotId?: string;
  }>
)._handler;
const prepareFixture = (
  prepareControlledExternalSkill as unknown as WrappedHandler<{ confirm: typeof confirm }>
)._handler;

beforeEach(() => {
  vi.stubEnv("CLAWHUB_ENV", "test");
  vi.stubEnv("CLAWHUB_DISABLE_CRONS", "1");
  vi.stubEnv("CLAWHUB_DEPLOYMENT_NAME", "academic-chihuahua-392");
});

afterEach(() => vi.unstubAllEnvs());

describe("CLAW-583 permanent-Test fixture", () => {
  it("repairs the legacy file hash and resets the controlled row before proof", async () => {
    const { db, tables } = createDb();
    const legacyHash = "42d2e89358ea927441dfede45c3b0cf89a21603bc7c32246f098d24a9cbea1ff";
    tables.skillsShMirrorDigests[0]!.sourceContentHash = legacyHash;
    tables.skillsShMirrorDigests[0]!.publicVisible = true;
    tables.skillsShMirrorDigests[0]!.installable = true;
    tables.skillsShMirrorDetails[0]!.sourceContentHash = legacyHash;

    await expect(prepareFixture({ db }, { confirm })).resolves.toMatchObject({
      ok: true,
      contentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
      hashRepaired: true,
      deactivated: true,
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    expect(tables.skillsShMirrorDigests[0]).toMatchObject({
      sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
      publicVisible: false,
      installable: false,
    });
    expect(tables.skillsShMirrorDetails[0]).toMatchObject({
      sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
    });
    await expect(readFixture({ db }, { confirm })).resolves.toMatchObject({
      contentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
      publicVisible: false,
      installable: false,
    });
  });

  it("refuses to prepare an unrelated content hash", async () => {
    const { db, tables } = createDb();
    tables.skillsShMirrorDigests[0]!.sourceContentHash = "b".repeat(64);

    await expect(prepareFixture({ db }, { confirm })).rejects.toThrow(
      "controlled mirror digest mismatch",
    );
  });

  it("activates and exactly restores only the controlled mirror flags", async () => {
    const { db, tables } = createDb();
    const ctx = { db, scheduler: { runAfter: async () => null } };

    await expect(readFixture(ctx, { confirm })).resolves.toMatchObject({
      externalId: "patrick-erichsen/skills/html",
      publicVisible: false,
      installable: false,
      scansPlanned: 0,
      scansAdmitted: 0,
    });
    const activation = (await activateFixture(ctx, { confirm })) as {
      digestId: string;
      sourceSnapshotId: string;
    };
    expect(tables.skillsShMirrorDigests[0]).toMatchObject({
      publicVisible: true,
      installable: true,
    });
    await expect(deactivateFixture(ctx, { confirm, ...activation })).resolves.toMatchObject({
      ok: true,
      deactivated: true,
      digestChanged: false,
      sourceSnapshotChanged: false,
    });
    expect(tables.skillsShMirrorDigests[0]).toMatchObject({
      publicVisible: false,
      installable: false,
    });
  });

  it("fails closed when the exact source coordinates drift", async () => {
    const { db, tables } = createDb();
    tables.skillsShMirrorDigests[0]!.githubCommit = "f".repeat(40);

    await expect(activateFixture({ db }, { confirm })).rejects.toThrow(
      "controlled mirror digest mismatch",
    );
    expect(tables.skillsShMirrorDigests[0]).toMatchObject({
      publicVisible: false,
      installable: false,
    });
  });

  it("forces the controlled row dark after the source snapshot changes", async () => {
    const { db, tables } = createDb();
    const activated = (await activateFixture({ db }, { confirm })) as {
      digestId: string;
      sourceSnapshotId: string;
    };
    tables.skillsShMirrorDigests[0]!.sourceSnapshotId = "newer-snapshot";

    await expect(deactivateFixture({ db }, { confirm, ...activated })).resolves.toMatchObject({
      ok: true,
      deactivated: true,
      sourceSnapshotChanged: true,
    });
    expect(tables.skillsShMirrorDigests[0]).toMatchObject({
      publicVisible: false,
      installable: false,
    });
  });

  it("forces the controlled row dark even when source coordinates drift", async () => {
    const { db, tables } = createDb();
    await activateFixture({ db }, { confirm });
    tables.skillsShMirrorDigests[0]!.githubCommit = "f".repeat(40);

    await expect(deactivateFixture({ db }, { confirm })).resolves.toMatchObject({
      ok: true,
      deactivated: true,
    });
    expect(tables.skillsShMirrorDigests[0]).toMatchObject({
      publicVisible: false,
      installable: false,
    });
  });
});

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

function createDb() {
  const tables: Record<string, Array<Record<string, unknown> & { _id: string }>> = {
    skillsShMirrorDigests: [
      {
        _id: "skillsShMirrorDigests:html",
        externalId: "patrick-erichsen/skills/html",
        sourceType: "github",
        owner: "patrick-erichsen",
        repo: "skills",
        slug: "html",
        sourceUrl: "https://www.skills.sh/patrick-erichsen/skills/html",
        githubPath: "skills/html",
        githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
        sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
        sourceSnapshotId: "snapshot-1",
        lastObservedRunId: "skillsShMirrorRuns:1",
        active: true,
        publicVisible: false,
        installable: false,
        sourceFreshnessStatus: "observed-only",
        detailStatus: "available",
      },
    ],
    skillsShMirrorDetails: [
      {
        _id: "skillsShMirrorDetails:html",
        externalId: "patrick-erichsen/skills/html",
        digestId: "skillsShMirrorDigests:html",
        sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
        content: "# HTML Artifact Chooser",
        contentBytes: 23,
      },
    ],
    skillsShMirrorRuns: [
      {
        _id: "skillsShMirrorRuns:1",
        counts: { scansPlanned: 0, scansAdmitted: 0 },
      },
    ],
  };
  const list = (table: string) => (tables[table] ??= []);
  const db = {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => {
      const table = id.split(":")[0] ?? "";
      return list(table).find((row) => row._id === id) ?? null;
    },
    patch: async (
      arg0: string,
      arg1: string | Record<string, unknown>,
      arg2?: Record<string, unknown>,
    ) => {
      const id = typeof arg1 === "string" ? arg1 : arg0;
      const value = arg2 ?? (arg1 as Record<string, unknown>);
      const table = id.split(":")[0] ?? "";
      Object.assign(
        list(table).find((row) => row._id === id)!,
        value,
      );
    },
    query: (table: string) => ({
      withIndex: (_name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
        const constraints: Record<string, unknown> = {};
        build(chainEq(constraints));
        return {
          unique: async () =>
            list(table).find((row) =>
              Object.entries(constraints).every(([field, value]) => row[field] === value),
            ) ?? null,
        };
      },
    }),
  };
  return { db, tables };
}
