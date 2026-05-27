/* @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorkerRun,
  loadDevWorkerEnv,
  parseArgs,
  resolveEnabledWorkers,
  resolveRunnableWorkers,
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

  it("aliases VITE_CONVEX_URL from shell env when .env.local is absent", async () => {
    const root = await tempDir();
    const env: NodeJS.ProcessEnv = {
      VITE_CONVEX_URL: "https://dev.example",
      SECURITY_SCAN_WORKER_TOKEN: "from-shell",
    };

    const loaded = await loadDevWorkerEnv({ cwd: root, env });

    expect(loaded).toEqual({ envFile: null, loaded: ["CONVEX_URL"] });
    expect(env.CONVEX_URL).toBe("https://dev.example");
    expect(validateWorkerEnv(WORKERS[0]!, env)).toEqual([]);
  });

  it("resolves enabled workers from include and skip lists", () => {
    const selected = resolveEnabledWorkers({
      workers: ["security-scan", "skill-card"],
      skip: ["skill-card"],
    });

    expect(selected.map((worker) => worker.id)).toEqual(["security-scan"]);
  });

  it("skips the default Skill Card worker when NVIDIA tooling is absent", async () => {
    const root = await tempDir();
    const selected = resolveEnabledWorkers({
      workers: [],
      skip: [],
    });

    const resolved = resolveRunnableWorkers(selected, parseArgs([]), {
      cwd: root,
      env: {},
    });

    expect(resolved.workers.map((worker) => worker.id)).toEqual(["security-scan"]);
    expect(resolved.skipped).toEqual([
      expect.objectContaining({
        workerId: "skill-card",
        reason: expect.stringContaining("NVIDIA Skill Card automation checkout"),
      }),
    ]);
  });

  it("keeps the Skill Card worker when an explicit NVIDIA tool checkout exists", async () => {
    const root = await tempDir();
    const toolDir = join(root, "nvidia-tooling");
    await mkdir(join(toolDir, "AI Transparency Card Automation", "scripts"), { recursive: true });
    await writeFile(
      join(toolDir, "AI Transparency Card Automation", "scripts", "render_card.py"),
      "print('render')\n",
      "utf8",
    );
    const selected = resolveEnabledWorkers({
      workers: ["skill-card"],
      skip: [],
    });

    const resolved = resolveRunnableWorkers(
      selected,
      parseArgs(["--workers", "skill-card", "--nvidia-tool-dir", toolDir]),
      { cwd: root, env: {} },
    );

    expect(resolved.workers.map((worker) => worker.id)).toEqual(["skill-card"]);
    expect(resolved.skipped).toEqual([]);
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
