import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import frozenSnapshot from "../../convex/fixtures/skills-sh-500-2026-07-21.json";

const OUTPUT_PATH = resolve(process.cwd(), "proof/claw-556/skills-sh-500-local-proof.json");
const LOCAL_CONFIG_PATH = resolve(process.cwd(), ".convex/local/default/config.json");

type LocalConfig = {
  adminKey: string;
  deploymentName: string;
  ports: {
    cloud: number;
    site: number;
  };
};

type CallKind = "mutation" | "query";
type InternalQuery = FunctionReference<"query", "internal">;
type InternalMutation = FunctionReference<"mutation", "internal">;
type AdminConvexClient = {
  setAdminAuth(adminKey: string): void;
  query<Query extends InternalQuery>(
    query: Query,
    args: FunctionArgs<Query>,
  ): Promise<FunctionReturnType<Query>>;
  mutation<Mutation extends InternalMutation>(
    mutation: Mutation,
    args: FunctionArgs<Mutation>,
  ): Promise<FunctionReturnType<Mutation>>;
};
type RunReadback = FunctionReturnType<typeof internal.skillsShCatalog.getRunInternal>;

const calls = {
  mutation: 0,
  query: 0,
  expectedErrors: 0,
  unexpectedErrors: 0,
};

const memory = {
  backendPid: null as number | null,
  backendRssStartKiB: 0,
  backendRssPeakKiB: 0,
  backendRssEndKiB: 0,
  driverRssStartBytes: process.memoryUsage().rss,
  driverRssPeakBytes: process.memoryUsage().rss,
  driverRssEndBytes: 0,
  driverHeapPeakBytes: process.memoryUsage().heapUsed,
  driverMaxRssStartBytes: process.resourceUsage().maxRSS,
  driverMaxRssEndBytes: 0,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readNumber(command: string[]): number {
  try {
    return (
      Number(
        execFileSync(command[0]!, command.slice(1), {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      ) || 0
    );
  } catch {
    return 0;
  }
}

function sampleMemory() {
  const usage = process.memoryUsage();
  memory.driverRssPeakBytes = Math.max(memory.driverRssPeakBytes, usage.rss);
  memory.driverHeapPeakBytes = Math.max(memory.driverHeapPeakBytes, usage.heapUsed);
  if (memory.backendPid) {
    const rss = readNumber(["ps", "-o", "rss=", "-p", String(memory.backendPid)]);
    memory.backendRssPeakKiB = Math.max(memory.backendRssPeakKiB, rss);
  }
}

async function measured<T>(kind: CallKind, operation: () => Promise<T>) {
  calls[kind] += 1;
  try {
    return await operation();
  } catch (error) {
    calls.unexpectedErrors += 1;
    throw error;
  } finally {
    sampleMemory();
  }
}

async function expectedFailure<T>(kind: CallKind, operation: () => Promise<T>, message: string) {
  calls[kind] += 1;
  try {
    await operation();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    assert(detail.includes(message), `expected error containing "${message}"`);
    calls.expectedErrors += 1;
    sampleMemory();
    return detail;
  }
  throw new Error(`expected operation to fail with "${message}"`);
}

function chunks<T>(values: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function collectPage<T>(
  readPage: (cursor: string | null) => Promise<{
    page: T[];
    isDone: boolean;
    continueCursor: string;
  }>,
) {
  const documents: T[] = [];
  let cursor: string | null = null;
  do {
    const result = await readPage(cursor);
    documents.push(...result.page);
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return documents;
}

async function main() {
  const startedAt = performance.now();
  const config = JSON.parse(await readFile(LOCAL_CONFIG_PATH, "utf8")) as LocalConfig;
  memory.backendPid =
    readNumber(["lsof", "-t", `-iTCP:${config.ports.cloud}`, "-sTCP:LISTEN"]) || null;
  assert(memory.backendPid, "local Convex backend is not listening");
  memory.backendRssStartKiB = readNumber(["ps", "-o", "rss=", "-p", String(memory.backendPid)]);
  memory.backendRssPeakKiB = memory.backendRssStartKiB;

  const client = new ConvexHttpClient(
    `http://127.0.0.1:${config.ports.cloud}`,
  ) as unknown as AdminConvexClient;
  client.setAdminAuth(config.adminKey);

  const query = <T>(operation: () => Promise<T>) => measured("query", operation);
  const mutation = <T>(operation: () => Promise<T>) => measured("mutation", operation);

  const initial = await query(() => client.query(internal.skillsShCatalog.getStatusInternal, {}));
  assert(initial.control.mode === "off", "catalog control must start off");
  assert(initial.runs.length === 0, "proof requires a fresh local deployment");
  assert(initial.entries.length === 0, "proof requires no catalog entries");

  const nativeBefore = {
    skills: await collectPage<Doc<"skills">>((cursor) =>
      query(() =>
        client.query(internal.skillsShCatalog.listNativeSkillsIsolationPageInternal, {
          paginationOpts: { cursor, numItems: 100 },
        }),
      ),
    ),
    scanJobs: await collectPage<Doc<"securityScanJobs">>((cursor) =>
      query(() =>
        client.query(internal.skillsShCatalog.listNativeScanJobsIsolationPageInternal, {
          paginationOpts: { cursor, numItems: 100 },
        }),
      ),
    ),
  };
  const nativeBeforeHash = stableHash(nativeBefore);

  await mutation(() =>
    client.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
      actor: "claw-556-local-proof",
      reason: "20,000-row discovery overload proof",
      confirm: "enable-skills-sh-fixture-control",
      mode: "fixture",
      discoveryEnabled: true,
      writesEnabled: false,
      scanPlanningEnabled: true,
      scanAdmissionEnabled: false,
      maxEntriesPerRun: 20_000,
      maxEntriesPerBatch: 250,
      maxWritesPerBatch: 2,
      maxPlannedScans: 20_000,
      maxScanAdmissionsPerBatch: 0,
      maxScanAdmissionsPerRun: 0,
      maxScanAdmissionsPerDay: 0,
      maxCatalogQueued: 0,
      maxCatalogInFlight: 0,
      maxNativeQueued: 0,
      maxNativeInFlight: 0,
      realScanAllowlist: [],
    }),
  );
  const dryStart = await mutation(() =>
    client.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "synthetic-20000-v1",
      actor: "claw-556-local-proof",
      reason: "20,000-row discovery must not enqueue",
      dryRun: true,
    }),
  );
  let dryRun = await query(() =>
    client.query(internal.skillsShCatalog.getRunInternal, {
      runId: dryStart.runId,
    }),
  );
  while (dryRun?.status === "running") {
    await mutation(() =>
      client.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
        runId: dryStart.runId,
      }),
    );
    dryRun = await query(() =>
      client.query(internal.skillsShCatalog.getRunInternal, {
        runId: dryStart.runId,
      }),
    );
  }
  assert(dryRun?.status === "completed", "20,000-row dry run did not finish");
  const entriesAfterDryRun = await collectPage<Doc<"skillsShCatalogEntries">>((cursor) =>
    query(() =>
      client.query(internal.skillsShCatalog.listEntriesPageInternal, {
        paginationOpts: { cursor, numItems: 100 },
      }),
    ),
  );
  const attemptsAfterDryRun = await collectPage<Doc<"skillsShCatalogScanAttempts">>((cursor) =>
    query(() =>
      client.query(internal.skillsShCatalog.listRunScanAttemptsPageInternal, {
        runId: dryStart.runId,
        paginationOpts: { cursor, numItems: 100 },
      }),
    ),
  );
  assert(entriesAfterDryRun.length === 0, "dry run persisted catalog entries");
  assert(attemptsAfterDryRun.length === 0, "dry run enqueued scan attempts");

  const mainControl = {
    actor: "claw-556-local-proof",
    reason: "bounded frozen 500 proof",
    confirm: "enable-skills-sh-fixture-control",
    mode: "fixture" as const,
    discoveryEnabled: true,
    writesEnabled: true,
    scanPlanningEnabled: true,
    scanAdmissionEnabled: true,
    maxEntriesPerRun: 500,
    maxEntriesPerBatch: 125,
    maxWritesPerBatch: 100,
    maxPlannedScans: 500,
    maxScanAdmissionsPerBatch: 50,
    maxScanAdmissionsPerRun: 500,
    maxScanAdmissionsPerDay: 500,
    maxCatalogQueued: 50,
    maxCatalogInFlight: 10,
    maxNativeQueued: 0,
    maxNativeInFlight: 0,
    realScanAllowlist: [] as string[],
  };
  await mutation(() =>
    client.mutation(internal.skillsShCatalog.configureFixtureControlInternal, mainControl),
  );
  const firstStart = await mutation(() =>
    client.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "skills-sh-500-2026-07-21",
      actor: "claw-556-local-proof",
      reason: "first frozen 500 application",
    }),
  );
  const firstBatch = await mutation(() =>
    client.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
      runId: firstStart.runId,
    }),
  );
  await mutation(() =>
    client.mutation(internal.skillsShCatalog.setFixtureRunPausedInternal, {
      runId: firstStart.runId,
      paused: true,
    }),
  );
  await expectedFailure(
    "mutation",
    () =>
      client.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
        runId: firstStart.runId,
      }),
    "run is paused",
  );
  const pausedReadback = await query(() =>
    client.query(internal.skillsShCatalog.getRunInternal, {
      runId: firstStart.runId,
    }),
  );
  assert(
    pausedReadback?.cursor === firstBatch.cursor &&
      pausedReadback.counts.observed === firstBatch.counts.observed,
    "pause replayed or advanced a completed batch",
  );
  await mutation(() =>
    client.mutation(internal.skillsShCatalog.setFixtureRunPausedInternal, {
      runId: firstStart.runId,
      paused: false,
    }),
  );
  let firstRun: RunReadback = pausedReadback;
  while (firstRun?.status === "paused" || firstRun?.status === "running") {
    await mutation(() =>
      client.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
        runId: firstStart.runId,
      }),
    );
    firstRun = await query(() =>
      client.query(internal.skillsShCatalog.getRunInternal, {
        runId: firstStart.runId,
      }),
    );
  }
  assert(firstRun?.status === "completed", "frozen 500 run did not finish");

  const frozenEntries = (
    await collectPage<Doc<"skillsShCatalogEntries">>((cursor) =>
      query(() =>
        client.query(internal.skillsShCatalog.listEntriesPageInternal, {
          paginationOpts: { cursor, numItems: 100 },
        }),
      ),
    )
  ).filter((entry) => entry.sourceKind === "frozen-snapshot");
  assert(frozenEntries.length === 500, "frozen readback did not persist 500 rows");
  const changedExternalId = frozenSnapshot.rows[0]!.externalId;
  const initialAdmissionIds = [
    changedExternalId,
    ...frozenEntries
      .map((entry) => entry.externalId)
      .filter((externalId) => externalId !== changedExternalId),
  ].slice(0, 496);
  for (const externalIds of chunks(initialAdmissionIds, 50)) {
    await mutation(() =>
      client.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
        runId: firstStart.runId,
        externalIds,
        dispatchKind: "deterministic",
      }),
    );
    await mutation(() =>
      client.mutation(internal.skillsShCatalog.completeDeterministicScansInternal, {
        runId: firstStart.runId,
        limit: externalIds.length,
      }),
    );
  }
  firstRun = await query(() =>
    client.query(internal.skillsShCatalog.getRunInternal, {
      runId: firstStart.runId,
    }),
  );
  assert(
    firstRun?.counts.scansAdmitted === 496 && firstRun.counts.scansCompleted === 496,
    "initial deterministic scans did not reconcile",
  );

  const repeatedStart = await mutation(() =>
    client.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "skills-sh-500-2026-07-21",
      actor: "claw-556-local-proof",
      reason: "identical frozen rerun",
    }),
  );
  let repeatedRun = await query(() =>
    client.query(internal.skillsShCatalog.getRunInternal, {
      runId: repeatedStart.runId,
    }),
  );
  while (repeatedRun?.status === "running") {
    await mutation(() =>
      client.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
        runId: repeatedStart.runId,
      }),
    );
    repeatedRun = await query(() =>
      client.query(internal.skillsShCatalog.getRunInternal, {
        runId: repeatedStart.runId,
      }),
    );
  }
  assert(
    repeatedRun?.counts.unchanged === 500 && repeatedRun.counts.scansPlanned === 0,
    "identical rerun was not idempotent",
  );

  const configureSynthetic = async (maxEntriesPerRun: number, maxScanAdmissionsPerDay: number) =>
    mutation(() =>
      client.mutation(internal.skillsShCatalog.configureFixtureControlInternal, {
        ...mainControl,
        reason: "atomic scan-admission proof",
        maxEntriesPerRun,
        maxEntriesPerBatch: maxEntriesPerRun,
        maxPlannedScans: maxEntriesPerRun,
        maxScanAdmissionsPerBatch: 1,
        maxScanAdmissionsPerRun: 1,
        maxScanAdmissionsPerDay,
        maxCatalogQueued: 1,
        maxCatalogInFlight: 1,
      }),
    );
  const runSynthetic = async (maxEntriesPerRun: number) => {
    const started = await mutation(() =>
      client.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
        fixtureId: "synthetic-20000-v1",
        actor: "claw-556-local-proof",
        reason: `synthetic ${maxEntriesPerRun}-row admission race`,
      }),
    );
    let run = await query(() =>
      client.query(internal.skillsShCatalog.getRunInternal, {
        runId: started.runId,
      }),
    );
    while (run?.status === "running") {
      await mutation(() =>
        client.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
          runId: started.runId,
        }),
      );
      run = await query(() =>
        client.query(internal.skillsShCatalog.getRunInternal, {
          runId: started.runId,
        }),
      );
    }
    return started.runId;
  };

  await configureSynthetic(2, 500);
  const sameRunId = await runSynthetic(2);
  const sameRunEntries = (
    await collectPage<Doc<"skillsShCatalogEntries">>((cursor) =>
      query(() =>
        client.query(internal.skillsShCatalog.listEntriesPageInternal, {
          paginationOpts: { cursor, numItems: 100 },
        }),
      ),
    )
  ).filter((entry) => entry.owner === "synthetic-owner");
  const sameRunRace = await Promise.allSettled(
    sameRunEntries.slice(0, 2).map((entry) =>
      measured("mutation", () =>
        client.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
          runId: sameRunId,
          externalIds: [entry.externalId],
          dispatchKind: "deterministic",
        }),
      ),
    ),
  );
  const sameRunFulfilled = sameRunRace.filter((result) => result.status === "fulfilled");
  const sameRunRejected = sameRunRace.filter((result) => result.status === "rejected");
  assert(
    sameRunFulfilled.length === 1 && sameRunRejected.length === 1,
    "same-run concurrent admission exceeded its cap",
  );
  calls.unexpectedErrors -= sameRunRejected.length;
  calls.expectedErrors += sameRunRejected.length;
  const sameRunAttempts = await collectPage<Doc<"skillsShCatalogScanAttempts">>((cursor) =>
    query(() =>
      client.query(internal.skillsShCatalog.listRunScanAttemptsPageInternal, {
        runId: sameRunId,
        paginationOpts: { cursor, numItems: 100 },
      }),
    ),
  );
  assert(sameRunAttempts.length === 1, "same-run race persisted more than one attempt");

  await configureSynthetic(3, 500);
  const queueHealthRunId = await runSynthetic(3);
  const queueHealthEntries = (
    await collectPage<Doc<"skillsShCatalogEntries">>((cursor) =>
      query(() =>
        client.query(internal.skillsShCatalog.listEntriesPageInternal, {
          paginationOpts: { cursor, numItems: 100 },
        }),
      ),
    )
  ).filter((entry) => entry.owner === "synthetic-owner" && entry.scanStatus === "planned");
  assert(queueHealthEntries.length >= 1, "queue-health proof needs a planned row");
  await expectedFailure(
    "mutation",
    () =>
      client.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
        runId: queueHealthRunId,
        externalIds: [queueHealthEntries[0]!.externalId],
        dispatchKind: "deterministic",
      }),
    "queued-scan budget exceeded",
  );
  await mutation(() =>
    client.mutation(internal.skillsShCatalog.markScanAttemptRunningInternal, {
      attemptId: sameRunAttempts[0]!._id,
    }),
  );
  await mutation(() =>
    client.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId: queueHealthRunId,
      externalIds: [queueHealthEntries[0]!.externalId],
      dispatchKind: "deterministic",
    }),
  );
  const queueHealthAttempts = await collectPage<Doc<"skillsShCatalogScanAttempts">>((cursor) =>
    query(() =>
      client.query(internal.skillsShCatalog.listRunScanAttemptsPageInternal, {
        runId: queueHealthRunId,
        paginationOpts: { cursor, numItems: 100 },
      }),
    ),
  );
  assert(queueHealthAttempts.length === 1, "queue-health proof did not persist one queued attempt");
  await expectedFailure(
    "mutation",
    () =>
      client.mutation(internal.skillsShCatalog.markScanAttemptRunningInternal, {
        attemptId: queueHealthAttempts[0]!._id,
      }),
    "scan start is blocked by queue health",
  );
  await mutation(() =>
    client.mutation(internal.skillsShCatalog.cancelCatalogRunInternal, {
      runId: sameRunId,
      limit: 10,
    }),
  );
  await mutation(() =>
    client.mutation(internal.skillsShCatalog.cancelCatalogRunInternal, {
      runId: queueHealthRunId,
      limit: 10,
    }),
  );

  await configureSynthetic(4, 499);
  const dailyRunA = await runSynthetic(4);
  await configureSynthetic(5, 499);
  const dailyRunB = await runSynthetic(5);
  const syntheticEntries = (
    await collectPage<Doc<"skillsShCatalogEntries">>((cursor) =>
      query(() =>
        client.query(internal.skillsShCatalog.listEntriesPageInternal, {
          paginationOpts: { cursor, numItems: 100 },
        }),
      ),
    )
  ).filter((entry) => entry.owner === "synthetic-owner");
  const dailyCandidates = syntheticEntries.filter((entry) => entry.scanStatus === "planned");
  assert(dailyCandidates.length >= 2, "daily race needs two planned rows");
  const dailyRace = await Promise.allSettled([
    measured("mutation", () =>
      client.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
        runId: dailyRunA,
        externalIds: [dailyCandidates[0]!.externalId],
        dispatchKind: "deterministic",
      }),
    ),
    measured("mutation", () =>
      client.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
        runId: dailyRunB,
        externalIds: [dailyCandidates[1]!.externalId],
        dispatchKind: "deterministic",
      }),
    ),
  ]);
  const dailyFulfilled = dailyRace.filter((result) => result.status === "fulfilled");
  const dailyRejected = dailyRace.filter((result) => result.status === "rejected");
  assert(
    dailyFulfilled.length === 1 && dailyRejected.length === 1,
    "cross-run daily admission exceeded its cap",
  );
  calls.unexpectedErrors -= dailyRejected.length;
  calls.expectedErrors += dailyRejected.length;
  const dailyWinnerRunId = dailyRace[0]?.status === "fulfilled" ? dailyRunA : dailyRunB;
  await mutation(() =>
    client.mutation(internal.skillsShCatalog.completeDeterministicScansInternal, {
      runId: dailyWinnerRunId,
      limit: 1,
    }),
  );

  await mutation(() =>
    client.mutation(internal.skillsShCatalog.configureFixtureControlInternal, mainControl),
  );
  const changedStart = await mutation(() =>
    client.mutation(internal.skillsShCatalog.startFixtureRunInternal, {
      fixtureId: "skills-sh-500-2026-07-21-v2",
      actor: "claw-556-local-proof",
      reason: "changed frozen rerun",
    }),
  );
  let changedRun = await query(() =>
    client.query(internal.skillsShCatalog.getRunInternal, {
      runId: changedStart.runId,
    }),
  );
  while (changedRun?.status === "running") {
    await mutation(() =>
      client.mutation(internal.skillsShCatalog.processFixtureBatchInternal, {
        runId: changedStart.runId,
      }),
    );
    changedRun = await query(() =>
      client.query(internal.skillsShCatalog.getRunInternal, {
        runId: changedStart.runId,
      }),
    );
  }
  assert(
    changedRun?.counts.updated === 2 && changedRun.counts.scansPlanned === 1,
    "changed rerun did not produce exactly two updates and one rescan plan",
  );
  await mutation(() =>
    client.mutation(internal.skillsShCatalog.admitFixtureScansInternal, {
      runId: changedStart.runId,
      externalIds: [changedExternalId],
      dispatchKind: "deterministic",
    }),
  );
  await mutation(() =>
    client.mutation(internal.skillsShCatalog.completeDeterministicScansInternal, {
      runId: changedStart.runId,
      limit: 1,
    }),
  );
  changedRun = await query(() =>
    client.query(internal.skillsShCatalog.getRunInternal, {
      runId: changedStart.runId,
    }),
  );
  assert(
    changedRun?.counts.scansAdmitted === 1 && changedRun.counts.scansCompleted === 1,
    "changed rerun scan did not reconcile",
  );

  const finalFrozenEntries = (
    await collectPage<Doc<"skillsShCatalogEntries">>((cursor) =>
      query(() =>
        client.query(internal.skillsShCatalog.listEntriesPageInternal, {
          paginationOpts: { cursor, numItems: 100 },
        }),
      ),
    )
  ).filter((entry) => entry.sourceKind === "frozen-snapshot");
  const firstAttempts = await collectPage<Doc<"skillsShCatalogScanAttempts">>((cursor) =>
    query(() =>
      client.query(internal.skillsShCatalog.listRunScanAttemptsPageInternal, {
        runId: firstStart.runId,
        paginationOpts: { cursor, numItems: 100 },
      }),
    ),
  );
  const repeatedAttempts = await collectPage<Doc<"skillsShCatalogScanAttempts">>((cursor) =>
    query(() =>
      client.query(internal.skillsShCatalog.listRunScanAttemptsPageInternal, {
        runId: repeatedStart.runId,
        paginationOpts: { cursor, numItems: 100 },
      }),
    ),
  );
  const changedAttempts = await collectPage<Doc<"skillsShCatalogScanAttempts">>((cursor) =>
    query(() =>
      client.query(internal.skillsShCatalog.listRunScanAttemptsPageInternal, {
        runId: changedStart.runId,
        paginationOpts: { cursor, numItems: 100 },
      }),
    ),
  );
  const allAttempts = await collectPage<Doc<"skillsShCatalogScanAttempts">>((cursor) =>
    query(() =>
      client.query(internal.skillsShCatalog.listScanAttemptsPageInternal, {
        paginationOpts: { cursor, numItems: 100 },
      }),
    ),
  );
  assert(finalFrozenEntries.length === 500, "final frozen entry count drifted");
  assert(firstAttempts.length === 496, "first run attempt count drifted");
  assert(repeatedAttempts.length === 0, "identical rerun created attempts");
  assert(changedAttempts.length === 1, "changed rerun did not create one attempt");
  assert(
    finalFrozenEntries.every((entry) => !entry.publicVisible),
    "catalog entries became publicly visible",
  );
  assert(
    allAttempts.every((attempt) => attempt.dispatchKind === "deterministic"),
    "local proof created a real scan attempt",
  );

  await mutation(() =>
    client.mutation(internal.skillsShCatalog.disableCatalogInternal, {
      actor: "claw-556-local-proof",
      reason: "visibility and control rollback proof",
      confirm: "disable-skills-sh-catalog",
    }),
  );
  const disabled = await query(() => client.query(internal.skillsShCatalog.getStatusInternal, {}));
  assert(
    disabled.control.mode === "off" &&
      !disabled.control.discoveryEnabled &&
      !disabled.control.writesEnabled &&
      !disabled.control.scanAdmissionEnabled &&
      !disabled.control.publicVisibilityEnabled,
    "catalog kill switches did not fail closed",
  );

  const nativeAfter = {
    skills: await collectPage<Doc<"skills">>((cursor) =>
      query(() =>
        client.query(internal.skillsShCatalog.listNativeSkillsIsolationPageInternal, {
          paginationOpts: { cursor, numItems: 100 },
        }),
      ),
    ),
    scanJobs: await collectPage<Doc<"securityScanJobs">>((cursor) =>
      query(() =>
        client.query(internal.skillsShCatalog.listNativeScanJobsIsolationPageInternal, {
          paginationOpts: { cursor, numItems: 100 },
        }),
      ),
    ),
  };
  const nativeAfterHash = stableHash(nativeAfter);
  assert(nativeAfterHash === nativeBeforeHash, "native skills or native scan jobs changed");

  const cronsSource = await readFile(resolve(process.cwd(), "convex/crons.ts"), "utf8");
  assert(
    !cronsSource.includes("skillsShCatalog") && !cronsSource.includes("skills-sh"),
    "skills.sh scheduler reference exists",
  );

  memory.backendRssEndKiB = readNumber(["ps", "-o", "rss=", "-p", String(memory.backendPid)]);
  memory.backendRssPeakKiB = Math.max(memory.backendRssPeakKiB, memory.backendRssEndKiB);
  memory.driverRssEndBytes = process.memoryUsage().rss;
  memory.driverMaxRssEndBytes = process.resourceUsage().maxRSS;
  sampleMemory();

  const proof = {
    verdict: "pass",
    generatedAt: new Date().toISOString(),
    deployment: {
      kind: "disposable-local-convex",
      name: config.deploymentName,
      cloudUrl: `http://127.0.0.1:${config.ports.cloud}`,
      permanentTestDeployed: false,
      productionDeployed: false,
    },
    runtime: {
      elapsedMs: Math.round(performance.now() - startedAt),
      memory,
      clientCalls: calls,
      sourceFetchesDuringProof: 0,
      frozenSnapshotCaptureFetches: firstRun?.snapshotCaptureFetches ?? 0,
    },
    discovery20000: {
      observed: dryRun.counts.observed,
      plannedScans: dryRun.counts.scansPlanned,
      wouldInsert: dryRun.counts.wouldInsert,
      persistedInserts: dryRun.counts.inserted,
      authoritativePersistedEntries: entriesAfterDryRun.length,
      authoritativeScanAttempts: attemptsAfterDryRun.length,
      authoritativeNativeScanJobs: nativeBefore.scanJobs.length,
      batches: dryRun.budgetConsumed.batchesProcessed,
      operationEstimates: dryRun.operations,
    },
    frozen500: {
      capture: {
        snapshotId: firstRun.snapshotId,
        capturedAt: firstRun.sourceCapturedAt,
        sourceFetches: firstRun.snapshotCaptureFetches,
      },
      configuredBudgets: firstRun.budgets,
      firstRun: {
        expectedActions: {
          wouldInsert: firstRun.counts.wouldInsert,
          wouldUpdate: firstRun.counts.wouldUpdate,
          scansPlanned: firstRun.counts.scansPlanned,
        },
        persistedActions: {
          inserted: firstRun.counts.inserted,
          updated: firstRun.counts.updated,
          authoritativeEntries: frozenEntries.length,
          authoritativeAttempts: firstAttempts.length,
          completedDeterministicAttempts: firstRun.counts.scansCompleted,
        },
        counts: firstRun.counts,
        batches: firstRun.budgetConsumed,
        operationEstimates: firstRun.operations,
      },
      identicalRerun: {
        counts: repeatedRun.counts,
        authoritativeAttempts: repeatedAttempts.length,
        operationEstimates: repeatedRun.operations,
      },
      changedRerun: {
        counts: changedRun.counts,
        authoritativeAttempts: changedAttempts.length,
        exactSourceHashRescan: changedAttempts[0]?.sourceContentHash ?? null,
        artifactHash: changedAttempts[0]?.artifactContentHash ?? null,
        hashSemantics:
          "sourceContentHash is the upstream observation; deterministic fixture completion is not an independent ClawScan artifact hash",
        operationEstimates: changedRun.operations,
      },
      finalAuthoritativeEntries: finalFrozenEntries.length,
      allEntriesDark: finalFrozenEntries.every((entry) => !entry.publicVisible),
    },
    concurrency: {
      sameRun: {
        fulfilled: sameRunFulfilled.length,
        rejected: sameRunRejected.length,
        cap: 1,
      },
      queueHealth: {
        queuedAtThresholdRejected: true,
        inFlightAtThresholdRejected: true,
        maxCatalogQueued: 1,
        maxCatalogInFlight: 1,
      },
      crossRunDaily: {
        fulfilled: dailyFulfilled.length,
        rejected: dailyRejected.length,
        cap: 499,
        attemptsBeforeRace: 498,
      },
      finalCatalogAttemptsToday: allAttempts.length,
    },
    rollback: {
      controls: disabled.control,
      schedulesPresent: false,
      nativeBefore: {
        skills: nativeBefore.skills.length,
        scanJobs: nativeBefore.scanJobs.length,
        sha256: nativeBeforeHash,
      },
      nativeAfter: {
        skills: nativeAfter.skills.length,
        scanJobs: nativeAfter.scanJobs.length,
        sha256: nativeAfterHash,
      },
      nativeStateUnchanged: nativeBeforeHash === nativeAfterHash,
    },
    limits: {
      operationCountsAreEstimates: true,
      realTestQueueIntegration:
        "not deployed; real attempts require an allowlisted Test control and an external artifact fetch before completion",
      statusPreviewLimit: disabled.limits,
      authoritativeReadback:
        "all entry, attempt, native skill, and native scan-job counts above use paginated internal queries",
    },
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof, null, 2));
}

await main();
