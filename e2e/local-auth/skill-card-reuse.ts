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
  const burst = async () =>
    (await Promise.all(Array.from({ length: 8 }, (_, index) => claim(index)))).flat();
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

  // No retry/warm-up here: the populated eight-worker burst exercises the same
  // planner, admission and preparation transactions used by production workers.
  const claimed = await burst();
  expect(claimed).toHaveLength(4);
  expect(new Set(claimed.map(({ job }) => job.skillVersionId)).size).toBe(4);
  expect(new Set(claimed.map(({ job }) => job.claimSlot)).size).toBe(4);
  expect(claimed.every((receipt) => receipt.target && !receipt.reused)).toBe(true);
  await Promise.all(
    claimed.map((receipt, index) => complete(receipt, `# Skill Card\n\nNative card ${index}.`)),
  );
  const completed = await state();
  expect(completed.every(({ version }) => version.skillCardGeneration?.inputHash)).toBe(true);

  const beforeReuse = storageIds();
  for (const id of versionIds) {
    await change(id, false);
    await enqueue(id);
  }
  const reused = await burst();
  expect(reused).toHaveLength(4);
  expect(reused.every((receipt) => receipt.reused && !receipt.target)).toBe(true);
  expect(storageIds()).toEqual(beforeReuse);
  expect((await state()).map(({ version }) => version.files)).toEqual(
    completed.map(({ version }) => version.files),
  );
  expect(
    (await state()).every(({ jobs }) =>
      jobs.every((job) => job.status === "succeeded" && job.attempts <= 1),
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
