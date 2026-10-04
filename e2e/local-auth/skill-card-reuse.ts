import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import convexBrowser from "convex/browser";
import convexServer from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

const { ConvexHttpClient } = convexBrowser;
const { makeFunctionReference } = convexServer;
type ConvexClient = InstanceType<typeof ConvexHttpClient>;

type Receipt = {
  job: Doc<"skillCardGenerationJobs">;
  target?: { version: Doc<"skillVersions"> };
  reused?: true;
  deferred?: true;
};
type State = Array<{ version: Doc<"skillVersions">; jobs: Doc<"skillCardGenerationJobs">[] }>;

export async function proveSkillCardReuse(
  client: ConvexClient,
  versionId: Id<"skillVersions">,
  token: string,
  storageIds: () => string[],
) {
  const config = JSON.parse(readFileSync(".convex/local/default/config.json", "utf8")) as {
    adminKey: string;
    ports: { cloud: number };
  };
  const admin = new ConvexHttpClient(`http://127.0.0.1:${config.ports.cloud}`) as ConvexClient & {
    setAdminAuth(key: string): void;
  };
  admin.setAdminAuth(config.adminKey);
  const run = <T>(name: string, args: Record<string, unknown> = {}) =>
    admin.mutation(makeFunctionReference<"mutation">(name), args) as Promise<T>;
  const enqueue = (id: Id<"skillVersions">) =>
    run("skillCards:enqueueForVersionInternal", {
      versionId: id,
      source: "manual",
    });
  const change = (id: Id<"skillVersions">, semantic: boolean) =>
    run("skillCardDevSeed:changeInputs", {
      versionId: id,
      semantic,
    });
  let recipe = "a".repeat(64);
  const claim = async (worker: number): Promise<Receipt[]> =>
    client.action(api.skillCards.claimSkillCardJobs, {
      token,
      workerId: `reuse-proof-${worker}`,
      limit: 2,
      leaseMs: 60_000,
      generationHash: recipe,
    });
  const complete = (receipt: Receipt, markdown: string) =>
    client.action(api.skillCards.completeSkillCardJob, {
      token,
      jobId: receipt.job._id,
      leaseToken: receipt.job.leaseToken!,
      markdown,
    });
  const burst = async (round: number) => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) => claim(round * 8 + index)),
    );
    const receipts = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" ? outcome.value : [],
    );
    const rejections = outcomes.flatMap((outcome, worker) => {
      if (outcome.status === "fulfilled") return [];
      const message = String(outcome.reason);
      const admission = message
        .split("\n")
        .find((line) => line.startsWith("Uncaught Error: "))
        ?.slice("Uncaught Error: ".length);
      return [{ worker, admission: admission ?? message, message }];
    });
    console.log("Skill Card claim burst", {
      callers: outcomes.length,
      fulfilled: outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      rejected: rejections.length,
      rejections,
      receipts: receipts.length,
    });
    // Convex can reject excess callers before they lease a job.
    // Only delivered receipts are checked below.
    for (const { admission } of rejections) {
      expect([
        "Too many concurrent requests in a short period of time. Spread out your requests out over time or throttle them to avoid errors.",
        "Couldn't acquire a permit on this funrun",
      ]).toContain(admission);
    }
    return receipts;
  };
  // A rejected admission never leases its job. Ask again with new worker
  // ids until each seeded version has one receipt.
  const collect = async (expected: number) => {
    const byId = new Map<string, Receipt>();
    for (let round = 0; round < 4 && byId.size < expected; round += 1) {
      for (const receipt of await burst(round)) {
        byId.set(receipt.job._id, receipt);
      }
    }
    return [...byId.values()];
  };
  const versionIds = await run<Id<"skillVersions">[]>("skillCardDevSeed:seedExistingRows", {
    versionId,
  });
  const state = () =>
    admin.query(makeFunctionReference<"query">("skillCardDevSeed:state"), {
      versionIds,
    }) as Promise<State>;
  expect(versionIds).toHaveLength(4);
  expect((await state()).every(({ version }) => version.skillCardGeneration === undefined)).toBe(
    true,
  );

  // Eight simultaneous callers exceed the deployed two-shard claim fanout.
  // Admission rejection is permitted, but all four jobs must still be delivered.
  const claimed = await collect(4);
  expect(claimed).toHaveLength(4);
  expect(new Set(claimed.map(({ job }) => job.skillVersionId)).size).toBe(4);
  expect(new Set(claimed.map(({ job }) => job.claimSlot)).size).toBe(4);
  expect(claimed.every((receipt) => receipt.target && !receipt.reused)).toBe(true);
  const lease = (job: Doc<"skillCardGenerationJobs">) => ({
    id: job._id,
    token: job.leaseToken,
    slot: job.claimSlot,
  });
  const running = (await state()).flatMap(({ jobs }) =>
    jobs.filter((job) => job.status === "running"),
  );
  expect(running.map(lease).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    claimed.map(({ job }) => lease(job)).sort((a, b) => a.id.localeCompare(b.id)),
  );
  await Promise.all(
    claimed.map((receipt, index) => complete(receipt, `# Skill Card\n\nNative card ${index}.`)),
  );
  const completed = await state();
  expect(completed.every(({ version }) => version.skillCardGeneration?.inputHash)).toBe(true);
  expect(
    completed.every(({ jobs }) =>
      jobs.every(
        (job) =>
          job.status === "succeeded" &&
          job.leaseToken === undefined &&
          job.leaseExpiresAt === undefined &&
          job.claimSlot === undefined &&
          job.workerId === undefined,
      ),
    ),
  ).toBe(true);

  const beforeReuse = storageIds();
  for (const id of versionIds) {
    await change(id, false);
    await enqueue(id);
  }
  const reused = await collect(4);
  expect(reused).toHaveLength(4);
  expect(reused.every((receipt) => receipt.reused && !receipt.target)).toBe(true);
  expect(storageIds()).toEqual(beforeReuse);
  expect((await state()).map(({ version }) => version.files)).toEqual(
    completed.map(({ version }) => version.files),
  );
  expect(
    (await state()).every(({ jobs }) =>
      jobs.every(
        (job) =>
          job.status === "succeeded" &&
          job.attempts <= 1 &&
          job.leaseToken === undefined &&
          job.leaseExpiresAt === undefined &&
          job.claimSlot === undefined &&
          job.workerId === undefined,
      ),
    ),
  ).toBe(true);

  // Recipe changes must regenerate even when every source/security byte matches.
  recipe = "b".repeat(64);
  await enqueue(versionId);
  const [stale] = await claim(10);
  expect(stale.target).toBeTruthy();
  await change(versionId, true);
  const beforeStale = storageIds();
  const filesBeforeStale = (await state())[0].version.files;
  expect(await complete(stale, "# Obsolete result")).toMatchObject({ requeued: true });
  expect(storageIds()).toEqual(beforeStale);
  const afterStale = (await state())[0];
  expect(afterStale.version.files).toEqual(filesBeforeStale);
  expect(afterStale.jobs.find((job) => job._id === stale.job._id)).toMatchObject({
    status: "queued",
    attempts: 0,
  });
  await expect(complete(stale, "# Replayed stale token")).rejects.toThrow(/Lease mismatch/);
  expect(storageIds()).toEqual(beforeStale);
  const [fresh] = await claim(11);
  expect(fresh.target).toBeTruthy();
  await complete(fresh, "# Current evidence");

  for (let index = 0; index < 6; index += 1) {
    await change(versionId, true);
    await enqueue(versionId);
    const [racing] = await claim(20 + index);
    expect(racing.target).toBeTruthy();
    const before = (await state())[0].version.files;
    const blobs = storageIds();
    // Both paths have already executed, and both start an HTTP request here.
    // Spawning a CLI for the mutation would serialize this race behind startup.
    const [result] = await Promise.all([
      complete(racing, `# Racing result ${index}`),
      change(versionId, true),
    ]);
    if (result.requeued) {
      expect((await state())[0].version.files).toEqual(before);
      expect(storageIds()).toEqual(blobs);
    } else {
      expect(storageIds()).toHaveLength(blobs.length + 1);
    }
    await enqueue(versionId);
    const [latest] = await claim(30 + index);
    expect(latest.target).toBeTruthy();
    expect(latest.reused).toBeUndefined();
    await complete(latest, `# Latest race evidence ${index}`);
  }

  await change(versionId, true);
  await enqueue(versionId);
  const [rollback] = await claim(40);
  await change(versionId, true);
  const storageId = (await admin.action(
    makeFunctionReference<"action">("skillCardDevSeed:storeCard"),
    {},
  )) as Id<"_storage">;
  const beforeRollback = storageIds();
  const rollbackState = (await state())[0];
  await expect(
    run("skillCardDevSeed:failStaleCardDeletion", {
      jobId: rollback.job._id,
      leaseToken: rollback.job.leaseToken,
      storageId,
    }),
  ).rejects.toThrow(/fixture storage deletion failure/);
  expect(storageIds()).toEqual(beforeRollback);
  expect((await state())[0]).toEqual(rollbackState);
  expect(
    await client.action(api.skillCards.failSkillCardJob, {
      token,
      jobId: rollback.job._id,
      leaseToken: rollback.job.leaseToken!,
      error: "fixture storage deletion failure",
    }),
  ).toMatchObject({ retry: true });
  const failedJob = (await state())[0].jobs.find((job) => job._id === rollback.job._id)!;
  expect(failedJob.status).toBe("queued");
  expect(failedJob.leaseToken).toBeUndefined();
  await run("skillCardDevSeed:deleteCard", { storageId });
  expect(storageIds()).toEqual(beforeRollback.filter((id) => id !== storageId));
}
