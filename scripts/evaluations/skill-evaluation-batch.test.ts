/* @vitest-environment node */

import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NVIDIA_SKILL_EVALUATION_CONFIG,
  NVIDIA_SKILL_EVALUATION_CONFIG_KEY,
} from "../../convex/lib/skillEvaluationConfig";
import { runSkillEvaluationWorker } from "./run-skill-evaluation-worker";
import { materializeNvidiaSkillsSnapshot, runCommand } from "./skill-evaluation-runtime";

vi.mock("./skill-evaluation-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./skill-evaluation-runtime")>()),
  materializeNvidiaSkillsSnapshot: vi.fn(),
  runCommand: vi.fn(),
}));

const run = (id: string, supported = false) => ({
  ...NVIDIA_SKILL_EVALUATION_CONFIG,
  _id: id,
  configKey: supported ? NVIDIA_SKILL_EVALUATION_CONFIG_KEY : "old-config",
  leaseToken: `lease-${id}`,
  sourceCommit: "a".repeat(40),
});

const options = {
  evaluatorProject: "/tmp/pinned-evaluator",
  openAiApiKey: "host-provider-key",
  token: "host-worker-token",
  workerId: "test-worker",
};

describe("SkillEvaluator continuous worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T00:00:00Z"));
    vi.stubEnv("OPENAI_API_KEY", options.openAiApiKey);
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", options.token);
    vi.mocked(runCommand).mockImplementation(async (command) => ({
      exitCode: 0,
      stdout: command.includes("rev-parse")
        ? NVIDIA_SKILL_EVALUATION_CONFIG.evaluatorCommit
        : NVIDIA_SKILL_EVALUATION_CONFIG.evaluatorRelease,
      stderr: "",
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("keeps claiming after failures and skips until the queue is empty", async () => {
    const queue = [run("first", true), run("second"), run("third")];
    const events: string[] = [];
    vi.mocked(materializeNvidiaSkillsSnapshot).mockRejectedValue(new Error("fixture failure"));
    const action = vi.fn(async (reference, args) => {
      expect(args.token).toBe(options.token);
      const name = getFunctionName(reference).split(":")[1];
      events.push(`${name}:${args.runId ?? "queue"}`);
      if (name === "claimSkillEvaluationJobs") {
        expect(args).toMatchObject({ limit: 1, leaseMs: 10_800_000, workerId: "test-worker" });
        const next = queue.shift();
        return next ? [next] : [];
      }
      expect(args.leaseToken).toBe(`lease-${args.runId}`);
      return { retry: true };
    });

    expect(await runSkillEvaluationWorker({ ...options, client: { action } })).toEqual({
      claimed: 3,
      failed: 1,
    });
    expect(events).toEqual([
      "claimSkillEvaluationJobs:queue",
      "failSkillEvaluation:first",
      "claimSkillEvaluationJobs:queue",
      "skipSkillEvaluation:second",
      "claimSkillEvaluationJobs:queue",
      "skipSkillEvaluation:third",
      "claimSkillEvaluationJobs:queue",
    ]);
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.SECURITY_SCAN_WORKER_TOKEN).toBeUndefined();
  });

  it("retires between evaluations after one hour without claiming another job", async () => {
    const action = vi.fn(async (reference, _args) => {
      if (getFunctionName(reference).endsWith(":claimSkillEvaluationJobs")) return [run("first")];
      vi.advanceTimersByTime(60 * 60_000);
      return { ok: true };
    });
    expect(await runSkillEvaluationWorker({ ...options, client: { action } })).toEqual({
      claimed: 1,
      failed: 0,
    });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("does not reserve another skill while the current skill is still processing", async () => {
    let finish!: () => void;
    let started!: () => void;
    const processing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let claims = 0;
    const action = vi.fn(async (reference, _args) => {
      if (getFunctionName(reference).endsWith(":claimSkillEvaluationJobs")) {
        claims += 1;
        return claims === 1 ? [run("first")] : [];
      }
      started();
      await gate;
      return { ok: true };
    });
    const worker = runSkillEvaluationWorker({ ...options, client: { action } });
    await processing;
    expect(claims).toBe(1);
    finish();
    expect(await worker).toEqual({ claimed: 1, failed: 0 });
    expect(claims).toBe(2);
  });

  it("exits immediately when no jobs are claimable", async () => {
    const action = vi.fn().mockResolvedValue([]);
    expect(await runSkillEvaluationWorker({ ...options, client: { action } })).toEqual({
      claimed: 0,
      failed: 0,
    });
    expect(action).toHaveBeenCalledTimes(1);
  });
});
