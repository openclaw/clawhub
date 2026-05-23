/* @vitest-environment node */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorkerRun,
  loadDevWorkerEnv,
  parseArgs,
  resolveEnabledWorkers,
  validateWorkerEnv,
  WORKERS,
} from "./dev-workers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-dev-workers-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("dev-workers", () => {
  it("parses worker selection and polling options", () => {
    const options = parseArgs([
      "--once",
      "--interval-ms",
      "250",
      "--workers",
      "security-scan,skill-card",
      "--skip",
      "skill-card",
      "--batch-limit",
      "2",
      "--max-jobs",
      "4",
      "--max-runtime-minutes",
      "3",
    ]);

    expect(options.once).toBe(true);
    expect(options.intervalMs).toBe(250);
    expect(options.workers).toEqual(["security-scan", "skill-card"]);
    expect(options.skip).toEqual(["skill-card"]);
    expect(options.batchLimit).toBe(2);
    expect(options.maxJobs).toBe(4);
    expect(options.maxRuntimeMinutes).toBe(3);
  });

  it("defaults to a fast local polling interval", () => {
    expect(parseArgs([]).intervalMs).toBe(5000);
  });

  it("loads .env.local without overriding shell env and aliases VITE_CONVEX_URL", async () => {
    const root = await tempDir();
    await writeFile(
      join(root, ".env.local"),
      ["VITE_CONVEX_URL=https://dev.example", "SECURITY_SCAN_WORKER_TOKEN=from-file"].join("\n"),
      "utf8",
    );
    const env: NodeJS.ProcessEnv = {
      SECURITY_SCAN_WORKER_TOKEN: "from-shell",
    };

    const loaded = await loadDevWorkerEnv({ cwd: root, env });

    expect(loaded.envFile).toBe(join(root, ".env.local"));
    expect(env.CONVEX_URL).toBe("https://dev.example");
    expect(env.SECURITY_SCAN_WORKER_TOKEN).toBe("from-shell");
  });

  it("resolves enabled workers from include and skip lists", () => {
    const selected = resolveEnabledWorkers({
      workers: ["security-scan", "skill-card"],
      skip: ["skill-card"],
    });

    expect(selected.map((worker) => worker.id)).toEqual(["security-scan"]);
  });

  it("rejects unknown worker ids", () => {
    expect(() => resolveEnabledWorkers({ workers: ["bogus"], skip: [] })).toThrow(
      "Unknown worker: bogus",
    );
  });

  it("builds canonical worker script invocations", () => {
    const worker = WORKERS.find((candidate) => candidate.id === "skill-card");
    if (!worker) throw new Error("skill-card worker missing");

    const run = buildWorkerRun(worker, {
      batchLimit: 2,
      maxJobs: 3,
      maxRuntimeMinutes: 4,
      leaseMinutes: 5,
      nvidiaToolDir: null,
    });

    expect(run.command).toBe("bun");
    expect(run.args).toEqual([
      "scripts/skill-cards/run-skill-card-worker.ts",
      "--batch-limit",
      "2",
      "--max-jobs",
      "3",
      "--max-runtime-minutes",
      "4",
      "--lease-minutes",
      "5",
    ]);
  });

  it("reports missing required env for enabled workers", () => {
    const worker = WORKERS.find((candidate) => candidate.id === "security-scan");
    if (!worker) throw new Error("security-scan worker missing");

    expect(validateWorkerEnv(worker, { CONVEX_URL: "https://dev.example" })).toEqual([
      "SECURITY_SCAN_WORKER_TOKEN",
    ]);
  });
});
