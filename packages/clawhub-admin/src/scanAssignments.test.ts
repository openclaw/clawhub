import { describe, expect, it } from "vitest";
import { planScanWorkers, readWorkerAssignment } from "./scanAssignments.js";

const ids = Array.from({ length: 100 }, (_, n) => `v${n.toString().padStart(31, "0")}`);

describe("local scan worker assignments", () => {
  it("partitions every supplied identity once and preserves the reserved lane", () => {
    const plan = planScanWorkers(ids, 32);
    const assignments = JSON.parse(plan.inputs["assigned-jobs"]);
    expect(assignments).toHaveLength(9);
    expect(assignments.flat().sort()).toEqual([...ids].sort());
    expect(new Set(assignments.flat()).size).toBe(100);
    expect(Math.max(...assignments.map((part: string[]) => part.length))).toBeLessThan(25);
    expect(
      readWorkerAssignment(plan.inputs["assigned-jobs"], "priority", "priority-0"),
    ).toBeUndefined();
    expect(readWorkerAssignment(plan.inputs["assigned-jobs"], "shared", "shared-2")).toEqual(
      assignments[2],
    );
    expect(plan.inputs["batch-limit"]).toBe("32");
  });

  it("keeps empty shard assignments explicit instead of claiming unrelated work", () => {
    const plan = planScanWorkers(ids.slice(0, 1), 32);
    const parts: string[][] = JSON.parse(plan.inputs["assigned-jobs"]);
    const emptyShard = parts.findIndex((part) => part.length === 0);
    expect(
      readWorkerAssignment(plan.inputs["assigned-jobs"], "shared", `shared-${emptyShard}`),
    ).toEqual([]);
    expect(readWorkerAssignment(undefined, "shared", "shared-8")).toBeUndefined();
  });
  it("rejects duplicate IDs, malformed plans, invalid shard identities and oversized inputs", () => {
    expect(() => planScanWorkers([ids[0], ids[0]], 32)).toThrow("duplicate");
    expect(() => planScanWorkers([], 32)).toThrow("1–10000");
    expect(() => planScanWorkers(["not an id"], 32)).toThrow("securityScanJobs IDs");
    expect(() => planScanWorkers(ids, 1.5)).toThrow("integer");
    expect(() => planScanWorkers(Array(10001).fill(ids[0]), 32)).toThrow("1–10000");
    expect(() => readWorkerAssignment("[]", "shared", "shared-0")).toThrow("nine");
    const raw = planScanWorkers(ids, 32).inputs["assigned-jobs"];
    expect(() => readWorkerAssignment(raw, "shared", "shared-9")).toThrow("shared-0");
    expect(() => readWorkerAssignment(raw, "catalog", "shared-0")).toThrow("shared-0");
    expect(() => readWorkerAssignment("x".repeat(65001), "shared", "shared-0")).toThrow("budget");
  });

  it("fits a full dispatch in the workflow input budget", () => {
    const jobs = Array.from({ length: 1728 }, (_, n) => `v${n.toString().padStart(31, "0")}`);
    const plan = planScanWorkers(jobs, 32);
    expect(JSON.stringify(plan.inputs).length).toBeLessThan(65535);
    expect(
      readWorkerAssignment(plan.inputs["assigned-jobs"], "shared", "shared-8")!.length,
    ).toBeGreaterThan(100);
  });
  it("keeps job ownership stable as completed jobs leave the next dispatch", () => {
    const first = JSON.parse(planScanWorkers(ids, 32).inputs["assigned-jobs"]) as string[][];
    const next = JSON.parse(
      planScanWorkers([...ids.slice(50), ...ids.slice(17, 50)], 32).inputs["assigned-jobs"],
    ) as string[][];
    for (const [shard, part] of next.entries()) {
      expect(part.every((id) => first[shard].includes(id))).toBe(true);
    }
  });
  it("accounts for every job when the next dispatch cannot fit the backlog", () => {
    const jobs = Array.from({ length: 3456 }, (_, n) => `v${n.toString().padStart(31, "0")}`);
    const plan = planScanWorkers(jobs, 32);
    const assigned: string[] = JSON.parse(plan.inputs["assigned-jobs"]).flat();
    expect(assigned).toHaveLength(1728);
    expect(plan.deferredJobIds).toHaveLength(1728);
    expect([...assigned, ...plan.deferredJobIds].sort()).toEqual([...jobs].sort());
  });

  it("carries a skewed shard into the next dispatch without moving its ownership", () => {
    const jobs: string[] = [];
    for (let n = 0; jobs.length < 513 && n < 10000; n++) {
      const id = `v${n.toString().padStart(31, "0")}`;
      const raw = planScanWorkers([id], 32).inputs["assigned-jobs"];
      if (readWorkerAssignment(raw, "shared", "shared-0")!.length) jobs.push(id);
    }
    expect(jobs).toHaveLength(513);
    const plan = planScanWorkers(jobs, 32);
    expect(readWorkerAssignment(plan.inputs["assigned-jobs"], "shared", "shared-0")).toEqual(
      jobs.slice(0, 512),
    );
    expect(plan.deferredJobIds).toEqual([jobs[512]]);
    const next = planScanWorkers(plan.deferredJobIds, 32);
    expect(readWorkerAssignment(next.inputs["assigned-jobs"], "shared", "shared-0")).toEqual([
      jobs[512],
    ]);
  });
  it("accepts opaque IDs of different lengths and budgets the serialized workflow payload", () => {
    const short = "v".repeat(31);
    const jobs = [
      short,
      ...Array.from({ length: 1728 }, (_, n) => `v${n.toString().padStart(127, "0")}`),
    ];
    const plan = planScanWorkers(jobs, 32);
    const assigned: string[] = JSON.parse(plan.inputs["assigned-jobs"]).flat();
    expect(assigned).toContain(short);
    expect(plan.deferredJobIds.length).toBeGreaterThan(0);
    expect([...assigned, ...plan.deferredJobIds].sort()).toEqual([...jobs].sort());
    expect(JSON.stringify(plan.inputs).length).toBeLessThan(65535);
  });
});
