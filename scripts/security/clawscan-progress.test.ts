/* @vitest-environment node */
import { expect, it } from "vitest";
import { createClawScanProgressCollector, parseClawScanProgress } from "./clawscan-progress";

const line = (fields: Record<string, unknown> = {}) =>
  `[clawscan-progress] ${JSON.stringify({
    schemaVersion: "clawscan-progress-v1",
    event: "child_event",
    phase: "judge",
    elapsedMs: 10,
    pid: 42,
    sequence: 1,
    childEvent: "item.started",
    childItem: "command_execution",
    childState: "in_progress",
    ...fields,
  })}\n`;

it("projects only fixed enums and bounded numbers from hostile raw fields", () => {
  const safe = parseClawScanProgress(
    line({
      command: "PRIVATE",
      prompt: "PRIVATE",
      stdout: "PRIVATE",
      error: "PRIVATE",
      key: "PRIVATE",
      nested: { secret: "PRIVATE" },
    }),
  );
  expect(safe).toEqual({
    schemaVersion: "clawscan-progress-v1",
    event: "child_event",
    phase: "judge",
    elapsedMs: 10,
    pid: 42,
    sequence: 1,
    childEvent: "item.started",
    childItem: "command_execution",
    childState: "in_progress",
  });
  for (const fields of [
    { phase: "PRIVATE" },
    { childEvent: "PRIVATE" },
    { childItem: "PRIVATE" },
    { childState: "PRIVATE" },
    { sequence: 514 },
    { elapsedMs: -1 },
    { pid: 1.1 },
    { durationMs: 960001 },
    { event: "PRIVATE" },
    { failed: "PRIVATE" },
  ])
    expect(parseClawScanProgress(line(fields))).toBeUndefined();
  expect(parseClawScanProgress("[clawscan-progress] null")).toBeUndefined();
  expect(parseClawScanProgress('[clawscan-progress] "PRIVATE"')).toBeUndefined();
});

it("bounds records/lines, resynchronizes after hostile oversized input and retains final partial records", () => {
  const records: unknown[] = [];
  const collector = createClawScanProgressCollector((event) => records.push(event));
  const first = Buffer.from(line());
  collector.write(first.subarray(0, 21));
  collector.write(first.subarray(21));
  collector.write(Buffer.from("PRIVATE".repeat(2000) + "\n"));
  collector.write(Buffer.from(line({ childEvent: "turn.completed" }).trimEnd()));
  collector.end();
  expect(records).toHaveLength(2);
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
  expect(collector.counts).toEqual({ retained: 2, rejected: 1, limited: 0 });
  const bounded = createClawScanProgressCollector(() => {});
  bounded.write(Buffer.from(line().repeat(2051)));
  bounded.end();
  expect(bounded.counts).toEqual({ retained: 2048, rejected: 0, limited: 3 });
});
