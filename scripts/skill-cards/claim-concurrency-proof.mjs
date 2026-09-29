#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { runProofBackend } from "../ui-proof-backend.mjs";

const source = path.resolve(process.argv[2] || ".");
const baselineRef = process.argv[3];
if (!baselineRef)
  throw new Error("Usage: node claim-concurrency-proof.mjs SOURCE BASELINE_REF OUTPUT");
const output = path.resolve(process.argv[4]);
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const owner = await fs.readFile(path.join(source, "convex/lib/skillCardClaims.ts"), "utf8");
const schemaSource = await fs.readFile(path.join(source, "convex/schema.ts"), "utf8");
const oldOwner = execFileSync(
  "git",
  ["-C", source, "show", baselineRef + ":convex/skillCards.ts"],
  { encoding: "utf8" },
);
const baseline = oldOwner.slice(
  oldOwner.indexOf("export const claimQueuedJobsInternal ="),
  oldOwner.indexOf("export const getJobTargetInternal ="),
);
const table = schemaSource.slice(
  schemaSource.indexOf("const skillCardGenerationJobs ="),
  schemaSource.indexOf("\nconst packageStatEvents"),
);
const proofSchema = `import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
const skillCardGenerationJobStatusValidator = v.union(v.literal("queued"),v.literal("running"),v.literal("succeeded"),v.literal("failed"));
const skillCardGenerationJobSourceValidator = v.union(v.literal("publish"),v.literal("scan"),v.literal("manual"));
${table}
export default defineSchema({skills:defineTable({}),skillVersions:defineTable({}),skillCardGenerationJobs});
`;
const functions = `import { actionGeneric as action, mutationGeneric as internalMutation, queryGeneric as query, makeFunctionReference as ref } from "convex/server";
import { v, ConvexError } from "convex/values";
import { planSkillCardClaims, admitSkillCardClaims } from "./skillCardClaims";
const DEFAULT_LEASE_MS=3600000, MAX_PARALLEL_SKILL_CARD_JOBS=64;
const normalizeLimit=(n:number)=>Math.max(1,Math.min(Math.floor(n??6),64));
${baseline}
export const plan=query({args:{limit:v.number(),now:v.number()},handler:planSkillCardClaims});
const admissionArgs={limit:v.number(),workerId:v.string(),leaseMs:v.optional(v.number()),jobIds:v.array(v.id("skillCardGenerationJobs")),slots:v.array(v.number()),expiredJobIds:v.array(v.id("skillCardGenerationJobs"))};
export const admit=internalMutation({args:admissionArgs,handler:admitSkillCardClaims});
export const admitPreflight=internalMutation({args:admissionArgs,handler:admitSkillCardClaims});
export const admitDisjoint=internalMutation({args:admissionArgs,handler:admitSkillCardClaims});
export const claim=action({args:{limit:v.number(),workerId:v.string(),replans:v.number(),preflight:v.optional(v.boolean())},handler:async(ctx,args)=>{
 for(let attempt=0;attempt<args.replans;attempt++){
  const plan=await ctx.runQuery(ref("proof:plan"),{limit:args.limit,now:Date.now()});
  if(!plan.jobIds.length||!plan.slots.length)return {jobs:[],contended:false,attempts:attempt+1};
  const result=await ctx.runMutation(ref(args.preflight?"proof:admitPreflight":"proof:admit"),{...plan,limit:args.limit,workerId:args.workerId});
  if(!result.contended)return {...result,attempts:attempt+1};
 }
 return {jobs:[],contended:true,attempts:args.replans};
}});
export const seed=internalMutation({args:{queued:v.number(),running:v.number(),slotted:v.boolean(),leaseMs:v.optional(v.number())},handler:async(ctx,args)=>{
 for(const table of ["skillCardGenerationJobs","skillVersions","skills"]){for(const row of await ctx.db.query(table).collect())await ctx.db.delete(row._id);}
 const skillId=await ctx.db.insert("skills",{}),jobs=[];
 for(let index=0;index<args.queued+args.running;index++){
  const skillVersionId=await ctx.db.insert("skillVersions",{}),running=index<args.running;
  const doc={skillId,skillVersionId,status:running?"running":"queued",source:"scan",priority:0,nextRunAt:Date.now()-1,attempts:running?1:0,createdAt:index,updatedAt:Date.now(),...(running?{leaseToken:"seed-"+index,leaseExpiresAt:Date.now()+(args.leaseMs??3600000),...(args.slotted?{claimSlot:index}:{})}:{})};
  const _id=await ctx.db.insert("skillCardGenerationJobs",doc);jobs.push({_id,...doc});
 }
 return jobs;
}});
export const complete=internalMutation({args:{jobId:v.id("skillCardGenerationJobs"),leaseToken:v.string()},handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job||job.leaseToken!==args.leaseToken)throw new ConvexError("Lease mismatch");
 await ctx.db.patch(job._id,{status:"succeeded",claimSlot:undefined,leaseToken:undefined,leaseExpiresAt:undefined,workerId:undefined,completedAt:Date.now()});
}});
export const legacy=internalMutation({args:{ids:v.array(v.id("skillCardGenerationJobs"))},handler:async(ctx,args)=>{
 for(const id of args.ids)await ctx.db.patch(id,{status:"running",leaseToken:"legacy",leaseExpiresAt:Date.now()+3600000});
}});
export const expireVersion=internalMutation({args:{first:v.id("skillCardGenerationJobs"),second:v.id("skillCardGenerationJobs")},handler:async(ctx,args)=>{
 const first=await ctx.db.get(args.first);await ctx.db.patch(args.second,{skillVersionId:first.skillVersionId});
 await ctx.db.patch(args.first,{status:"running",claimSlot:42,leaseToken:"late",leaseExpiresAt:Date.now()+100});
}});
export const staleSlot=internalMutation({args:{id:v.id("skillCardGenerationJobs"),nextRunAt:v.number()},handler:async(ctx,args)=>{
 await ctx.db.patch(args.id,{claimSlot:0,priority:100,nextRunAt:args.nextRunAt});
}});
export const rows=query({args:{},handler:ctx=>ctx.db.query("skillCardGenerationJobs").collect()});
`;
const hash = (text) => createHash("sha256").update(text).digest("hex");
const provenance = {
  baselineRef,
  ownerSha256: hash(owner),
  baselineClaimSha256: hash(baseline),
  tableSha256: hash(table),
};
await fs.writeFile(path.join(output, "source-proof.json"), JSON.stringify(provenance, null, 2));
const archive = path.join(output, "backend.zip");
try {
  await fs.access(archive);
} catch {
  const res = await fetch(
    "https://github.com/get-convex/convex-backend/releases/download/precompiled-2026-08-25-7cce8fb/convex-local-backend-aarch64-apple-darwin.zip",
    { signal: AbortSignal.timeout(120000) },
  );
  if (!res.ok) throw new Error("Backend download HTTP " + res.status);
  await fs.writeFile(archive, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
}
const results = [];
for (const mode of ["baseline", "candidate-single", "candidate-bounded"]) {
  const app = path.join(output, mode + "-app");
  await fs.mkdir(path.join(app, "convex"), { recursive: true });
  await fs.writeFile(
    path.join(app, "package.json"),
    JSON.stringify({
      name: "claim-native-proof",
      private: true,
      dependencies: { convex: "1.44.0" },
    }),
  );
  await fs.writeFile(path.join(app, "convex/schema.ts"), proofSchema);
  await fs.writeFile(path.join(app, "convex/skillCardClaims.ts"), owner);
  await fs.writeFile(path.join(app, "convex/proof.ts"), functions);
  await fs.writeFile(
    path.join(app, "convex/appMeta.ts"),
    'import { queryGeneric } from "convex/server"; export const getDeploymentInfo=queryGeneric({args:{},handler:()=>({proof:"skill-card-claim"})});',
  );
  await fs.symlink(path.resolve("node_modules"), path.join(app, "node_modules"));
  const result = {
    mode,
    errors: 0,
    contended: 0,
    completed: 0,
    claims: 0,
    maxPlanAttempts: 0,
    errorsByKind: {},
    nativeRetries: {},
  };
  const outputDrained = [];
  await runProofBackend(
    {
      appRoot: app,
      wrapperRoot: app,
      outputDir: path.join(output, mode),
      cliPath: path.resolve("node_modules/convex/bin/main.js"),
      backendArchive: archive,
      lane: {
        name: mode === "baseline" ? "baseline" : "candidate",
        convexCloudPort: 45310,
        convexSitePort: 45311,
        port: 45312,
      },
      continueWith: async ({ env, signal }) => {
        const client = new ConvexHttpClient(env.VITE_CONVEX_URL, { logger: false });
        const call = (kind, name, args) =>
          kind === "mutation"
            ? client.mutation(makeFunctionReference("proof:" + name), args, { skipQueue: true })
            : client[kind](makeFunctionReference("proof:" + name), args);
        if (mode === "candidate-bounded") {
          let saturation = await call("mutation", "seed", {
            queued: 100,
            running: 0,
            slotted: true,
          });
          let saturationPlan = await call("query", "plan", { limit: 64, now: Date.now() });
          await Promise.all(
            [0, 1].map((i) =>
              call("mutation", "admitPreflight", {
                ...saturationPlan,
                limit: 64,
                workerId: "saturate-" + i,
              }),
            ),
          );
          let saturationRows = await call("query", "rows", {});
          assert.equal(saturationRows.filter((j) => j.status === "running").length, 64);
          assert.equal(
            new Set(saturationRows.filter((j) => j.status === "running").map((j) => j.claimSlot))
              .size,
            64,
          );
          saturation = await call("mutation", "seed", { queued: 100, running: 0, slotted: true });
          saturationPlan = await call("query", "plan", { limit: 64, now: Date.now() });
          await Promise.all([
            call("mutation", "claimQueuedJobsInternal", { limit: 32, workerId: "old-writer" }),
            call("mutation", "admitPreflight", {
              ...saturationPlan,
              limit: 64,
              workerId: "new-writer",
            }),
          ]);
          saturationRows = await call("query", "rows", {});
          assert.ok(saturationRows.filter((j) => j.status === "running").length <= 64);
          await call("action", "claim", {
            limit: 64,
            workerId: "finish-forward-overlap",
            preflight: true,
            replans: 64,
          });
          saturationRows = await call("query", "rows", {});
          assert.equal(saturationRows.filter((j) => j.status === "running").length, 64);
          const disjoint = await call("mutation", "seed", {
            queued: 32,
            running: 32,
            slotted: true,
          });
          await Promise.all(
            disjoint.slice(0, 32).flatMap((job, index) => [
              call("mutation", "complete", { jobId: job._id, leaseToken: job.leaseToken }),
              call("mutation", "admitDisjoint", {
                jobIds: [disjoint[32 + index]._id],
                slots: [32 + index],
                expiredJobIds: [],
                limit: 1,
                workerId: "disjoint-" + index,
              }),
            ]),
          );
          await call("mutation", "seed", { queued: 0, running: 64, slotted: true, leaseMs: 200 });
          assert.equal(
            (await call("query", "plan", { limit: 4, now: Date.now() })).jobIds.length,
            0,
          );
          await delay(250, undefined, { signal });
          assert.ok((await call("query", "plan", { limit: 4, now: Date.now() })).jobIds.length > 0);
          let seeded = await call("mutation", "seed", { queued: 70, running: 0, slotted: true });
          let plan = await call("query", "plan", { limit: 64, now: Date.now() });
          await call("mutation", "legacy", { ids: seeded.slice(0, 60).map((j) => j._id) });
          assert.deepEqual(
            await call("mutation", "admitPreflight", { ...plan, limit: 64, workerId: "mixed" }),
            { jobs: [], contended: true },
          );
          assert.equal(
            (
              await call("action", "claim", {
                limit: 64,
                workerId: "mixed-replanned",
                preflight: true,
                replans: 64,
              })
            ).jobs.length,
            4,
          );
          seeded = await call("mutation", "seed", { queued: 2, running: 0, slotted: true });
          plan = await call("query", "plan", { limit: 4, now: Date.now() });
          plan.jobIds = [seeded[1]._id];
          await call("mutation", "expireVersion", { first: seeded[0]._id, second: seeded[1]._id });
          await delay(150, undefined, { signal });
          assert.equal(
            (await call("mutation", "admitPreflight", { ...plan, limit: 4, workerId: "fence" }))
              .jobs.length,
            1,
          );
          await assert.rejects(
            call("mutation", "complete", { jobId: seeded[0]._id, leaseToken: "late" }),
          );
          // Old runtime rollback is unsupported once any numeric slot has persisted.
          const rollbackRows = await call("mutation", "seed", {
            queued: 2,
            running: 63,
            slotted: true,
          });
          const staleSlotId = rollbackRows[63]._id;
          const plannedId = rollbackRows[64]._id;
          const nextRunAt = Date.now() + 1000;
          await call("mutation", "staleSlot", { id: staleSlotId, nextRunAt });
          const rollbackPlan = await call("query", "plan", { limit: 1, now: nextRunAt - 1 });
          assert.deepEqual(rollbackPlan.jobIds, [plannedId]);
          await delay(Math.max(0, nextRunAt - Date.now() + 10), undefined, { signal });
          const oldReceipt = await call("mutation", "claimQueuedJobsInternal", {
            limit: 1,
            workerId: "unsupported-old-runtime",
          });
          assert.equal(oldReceipt[0]._id, staleSlotId);
          let rollbackRunning = (await call("query", "rows", {})).filter(
            (job) => job.status === "running",
          );
          assert.equal(rollbackRunning.length, 64);
          assert.equal(new Set(rollbackRunning.map((job) => job.claimSlot)).size, 63);
          assert.equal(
            (
              await call("mutation", "admitPreflight", {
                ...rollbackPlan,
                limit: 1,
                workerId: "stale-modern-plan",
              })
            ).jobs.length,
            1,
          );
          rollbackRunning = (await call("query", "rows", {})).filter(
            (job) => job.status === "running",
          );
          assert.equal(rollbackRunning.length, 65);
          result.invariants = [
            "monotone-saturation-64",
            "old-new-writer-phantom-race",
            "disjoint-numeric-completion",
            "cached-expiry-without-write",
            "legacy-arrives-after-plan",
            "expired-version-token-fenced",
            "unsupported-old-runtime-rollback-exceeds-cap",
          ];
        }
        const seeded = await call("mutation", "seed", {
          queued: 320,
          running: 32,
          slotted: mode !== "baseline",
        });
        const complete = async (job) => {
          await call("mutation", "complete", { jobId: job._id, leaseToken: job.leaseToken });
          result.completed++;
        };
        const start = performance.now();
        await Promise.all([
          ...seeded.slice(0, 32).map(async (job, index) => {
            await delay(index * 2, undefined, { signal });
            await complete(job);
          }),
          ...Array.from({ length: 24 }, (_, index) =>
            (async () => {
              for (let batch = 0; batch < 80; batch++) {
                signal.throwIfAborted();
                try {
                  let jobs;
                  if (mode === "baseline")
                    jobs = await call("mutation", "claimQueuedJobsInternal", {
                      limit: 4,
                      workerId: "worker-" + index,
                    });
                  else {
                    const receipt = await call("action", "claim", {
                      limit: 4,
                      workerId: "worker-" + index,
                      replans: mode === "candidate-single" ? 1 : 64,
                    });
                    jobs = receipt.jobs;
                    result.contended += Number(receipt.contended);
                    result.maxPlanAttempts = Math.max(result.maxPlanAttempts, receipt.attempts);
                  }
                  result.claims++;
                  if (!jobs.length) break;
                  await Promise.all(jobs.map(complete));
                } catch (error) {
                  result.errors++;
                  const kind = /concurrent|OCC|occ|changed while|retry/i.test(String(error))
                    ? "occ"
                    : "other";
                  result.errorsByKind[kind] = (result.errorsByKind[kind] || 0) + 1;
                  break;
                }
              }
            })(),
          ),
        ]);
        result.elapsedMs = Math.round(performance.now() - start);
        const rows = await call("query", "rows", {});
        result.remaining = rows.filter((j) => j.status === "queued").length;
        result.running = rows.filter((j) => j.status === "running").length;
        result.succeeded = rows.filter((j) => j.status === "succeeded").length;
        assert.ok(result.running <= 64);
        if (mode === "candidate-bounded") {
          assert.equal(result.errors, 0);
          assert.equal(result.contended, 0);
          assert.equal(result.remaining, 0);
          assert.equal(result.running, 0);
          assert.equal(result.succeeded, 352);
        }
      },
    },
    {
      timeoutMs: 120000,
      spawnImpl: (...args) => {
        const child = spawn(...args);
        if (String(args[0]).endsWith("/convex-local-backend") && args[1][0] !== "keygen") {
          const countLine = (line) => {
            const match = line
              .replace(/\x1b\[[0-9;]*m/g, "")
              .match(/retrying Udf\((proof\.js:[^)]+)\)/);
            if (match) result.nativeRetries[match[1]] = (result.nativeRetries[match[1]] || 0) + 1;
          };
          for (const stream of [child.stdout, child.stderr]) {
            let pending = "";
            stream.on("data", (chunk) => {
              pending += chunk.toString();
              const lines = pending.split("\n");
              pending = lines.pop();
              for (const line of lines) countLine(line);
            });
            outputDrained.push(
              new Promise((resolve) => {
                stream.on("end", () => {
                  if (pending) countLine(pending);
                  resolve();
                });
              }),
            );
          }
        }
        return child;
      },
    },
  );
  await Promise.all(outputDrained);
  const stressMutation =
    mode === "baseline" ? "proof.js:claimQueuedJobsInternal" : "proof.js:admit";
  result.stressRetries = result.nativeRetries[stressMutation] || 0;
  if (mode === "candidate-bounded") {
    result.disjointCompletionRetries = result.nativeRetries["proof.js:admitDisjoint"] || 0;
    assert.equal(result.disjointCompletionRetries, 0);
  }
  results.push(result);
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ provenance, results }, null, 2),
  );
  console.log(JSON.stringify(result));
}
