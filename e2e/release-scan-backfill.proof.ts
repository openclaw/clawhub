import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import convexBrowser from "convex/browser";
import convexServer from "convex/server";
import type { Doc, Id } from "../convex/_generated/dataModel";

const { ConvexHttpClient } = convexBrowser;
const { makeFunctionReference } = convexServer;
const publicBackfill = makeFunctionReference<"action">("packages:backfillPackageReleaseScans");
const internalBackfill = makeFunctionReference<"action">(
  "packages:backfillPackageReleaseScansInternal",
);
const seed = makeFunctionReference<"mutation">("releaseScanBackfillDevSeed:seed");
const actorState = makeFunctionReference<"mutation">("releaseScanBackfillDevSeed:setActorState");
const stateRef = makeFunctionReference<"query">("releaseScanBackfillDevSeed:state");
type Client = InstanceType<typeof ConvexHttpClient>;
type State = {
  queues: Array<{ releaseId: Id<"packageReleases">; jobs: Doc<"securityScanJobs">[] }>;
  scheduled: Array<{ _id: string; name: string; state: { kind: string } }>;
};

test("release scan backfill authorizes real sessions before queue or scheduler writes", async ({}, info) => {
  const config = process.env.REVIEW_ADMIN_KEY
    ? {
        adminKey: process.env.REVIEW_ADMIN_KEY,
        ports: { cloud: Number(new URL(process.env.VITE_CONVEX_URL!).port) },
      }
    : (JSON.parse(readFileSync(".convex/local/default/config.json", "utf8")) as {
        adminKey: string;
        ports: { cloud: number };
      });
  const url = `http://127.0.0.1:${config.ports.cloud}`;
  expect(process.env.VITE_CONVEX_URL).toBe(url);
  const operator = new ConvexHttpClient(url) as Client & { setAdminAuth(key: string): void };
  operator.setAdminAuth(config.adminKey);
  const anonymous = new ConvexHttpClient(url);
  const login = async (persona: "user" | "admin") => {
    const client = new ConvexHttpClient(url);
    const response = (await client.action(makeFunctionReference<"action">("auth:signIn"), {
      provider: "dev-persona",
      params: { persona },
    })) as { tokens?: { token: string } | null };
    if (!response.tokens?.token) throw new Error("Real local dev-auth session was not created");
    client.setAuth(response.tokens.token);
    const user = (await client.query(
      makeFunctionReference<"query">("users:me"),
      {},
    )) as Doc<"users"> | null;
    if (!user) throw new Error("Real session did not resolve its user");
    return { client, userId: user._id };
  };
  const user = await login("user");
  const admin = await login("admin");
  const releaseIds = (await operator.mutation(seed, {
    userId: admin.userId,
    phase: "public",
  })) as Id<"packageReleases">[];
  // Pre-existing active job must retain its identity rather than be duplicated.
  await operator.mutation(
    makeFunctionReference<"mutation">("securityScan:enqueuePackageReleaseScanInternal"),
    { releaseId: releaseIds[0], source: "backfill" },
  );
  const state = () => operator.query(stateRef, { releaseIds }) as Promise<State>;
  const receipts: unknown[] = [{ url, mode: process.env.RELEASE_SCAN_PROOF_EXPECT ?? "guarded" }];
  try {
    const before = await state();
    expect(before.queues.filter(({ jobs }) => jobs.length === 0)).toHaveLength(9);
    expect(before.queues[0].jobs).toHaveLength(1);
    const preexistingJobId = before.queues[0].jobs[0]._id;
    // Run the same real-backend fixture against main as an explicit negative control.
    if (process.env.RELEASE_SCAN_PROOF_EXPECT === "unguarded") {
      const result = await anonymous.action(publicBackfill, { batchSize: 100 });
      await expect
        .poll(async () => {
          const current = await state();
          return (
            current.queues.every(({ jobs }) => jobs.length === 1) &&
            current.scheduled.length >= 2 &&
            current.scheduled.every((job) => job.state.kind === "success")
          );
        })
        .toBe(true);
      receipts.push({ anonymousAccepted: result, before, after: await state() });
      return;
    }
    const denied = async (label: string, client: Client, message: string) => {
      const before = await state();
      await expect(client.action(publicBackfill, { batchSize: 100 })).rejects.toThrow(message);
      const after = await state();
      expect(after).toEqual(before);
      receipts.push({ label, before, after });
    };
    const invalidToken = new ConvexHttpClient(url);
    invalidToken.setAuth("invalid-local-proof-token");
    await expect(invalidToken.action(publicBackfill, { batchSize: 100 })).rejects.toThrow();
    expect(await state()).toEqual(before);
    receipts.push({ label: "invalid JWT", rejected: true, unchanged: true });
    await denied("anonymous", anonymous, "Unauthorized");
    await denied("ordinary user", user.client, "Forbidden");
    await operator.mutation(actorState, {
      userId: user.userId,
      role: "moderator",
      inactive: false,
    });
    await denied("moderator", user.client, "Forbidden");
    await operator.mutation(actorState, { userId: admin.userId, role: "admin", inactive: true });
    await denied("inactive admin with preexisting session", admin.client, "User not found");
    await operator.mutation(actorState, {
      userId: admin.userId,
      role: "admin",
      inactive: false,
      deleted: true,
    });
    await denied("deleted admin with preexisting session", admin.client, "User not found");
    await operator.mutation(actorState, { userId: admin.userId, role: "admin", inactive: false });
    await expect(anonymous.action(internalBackfill, { batchSize: 100 })).rejects.toThrow();
    expect(await state()).toEqual(before);
    const result = await admin.client.action(publicBackfill, { batchSize: 100 });
    await expect
      .poll(async () => {
        const current = await state();
        return (
          current.queues.every(({ jobs }) => jobs.length === 1 && jobs[0].status === "queued") &&
          current.scheduled.length >= 2 &&
          current.scheduled.every((job) => job.state.kind === "success")
        );
      })
      .toBe(true);
    receipts.push({
      label: "active admin plus multiple real scheduled pages",
      preexistingJobId,
      result,
      after: await state(),
    });
    expect((await state()).queues[0].jobs[0]._id).toBe(preexistingJobId);
    const oldIds = new Set((await state()).scheduled.map((job) => job._id));
    releaseIds.push(
      ...((await operator.mutation(seed, {
        userId: admin.userId,
        phase: "internal",
      })) as Id<"packageReleases">[]),
    );
    // A local deployment credential invokes the cron's internal entry point without a user JWT.
    const internalResult = await operator.action(internalBackfill, { batchSize: 100 });
    await expect
      .poll(async () => {
        const current = await state();
        const continuation = current.scheduled.filter((job) => !oldIds.has(job._id));
        return (
          current.queues.every(({ jobs }) => jobs.length === 1 && jobs[0].status === "queued") &&
          continuation.length >= 2 &&
          continuation.every((job) => job.state.kind === "success")
        );
      })
      .toBe(true);
    receipts.push({
      label: "internal entry and continuation without user session",
      result: internalResult,
      after: await state(),
    });
  } finally {
    // JWTs, local admin keys, and auth responses never enter the proof attachment.
    await info.attach("release-scan-authorization.json", {
      body: JSON.stringify(receipts, null, 2),
      contentType: "application/json",
    });
    await operator.mutation(actorState, { userId: user.userId, role: "user", inactive: false });
    await operator.mutation(actorState, { userId: admin.userId, role: "admin", inactive: false });
  }
});
