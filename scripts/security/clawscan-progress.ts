import { StringDecoder } from "node:string_decoder";

const phases = new Set([
  "prepare",
  "judge",
  ...[
    "agentverus",
    "aig",
    "cisco",
    "clawscan-static",
    "relyable",
    "skillspector",
    "snyk",
    "socket",
    "virustotal",
    "custom",
  ].map((name) => `scanner:${name}`),
]);
const events = new Set([
  "phase_start",
  "phase_end",
  "command_start",
  "command_end",
  "child_event",
  "child_event_dropped",
  "child_event_limit",
]);
const childEvents = new Set([
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "error",
  "item.started",
  "item.updated",
  "item.completed",
]);
const childItems = new Set([
  "command_execution",
  "reasoning",
  "agent_message",
  "file_change",
  "mcp_tool_call",
  "collab_tool_call",
  "web_search",
  "todo_list",
  "error",
]);
const childStates = new Set(["in_progress", "completed", "failed", "declined"]);

export type SafeClawScanProgress = {
  schemaVersion: "clawscan-progress-v1";
  event: string;
  phase: string;
  elapsedMs: number;
  pid?: number;
  durationMs?: number;
  exitCode?: number;
  failed?: boolean;
  childEvent?: string;
  childItem?: string;
  childState?: string;
  sequence?: number;
};

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

export function parseClawScanProgress(line: string): SafeClawScanProgress | undefined {
  if (!line.startsWith("[clawscan-progress] ")) return undefined;
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line.slice(20));
  } catch {
    return undefined;
  }
  if (
    !record ||
    Array.isArray(record) ||
    record.schemaVersion !== "clawscan-progress-v1" ||
    !events.has(record.event as string) ||
    !phases.has(record.phase as string) ||
    !integer(record.elapsedMs, 0, 960_000)
  )
    return undefined;
  const safe: SafeClawScanProgress = {
    schemaVersion: "clawscan-progress-v1",
    event: record.event as string,
    phase: record.phase as string,
    elapsedMs: record.elapsedMs,
  };
  for (const [key, minimum, maximum] of [
    ["pid", 1, 2_147_483_647],
    ["durationMs", 0, 960_000],
    ["exitCode", -255, 255],
  ] as const) {
    if (record[key] !== undefined) {
      if (!integer(record[key], minimum, maximum)) return undefined;
      safe[key] = record[key];
    }
  }
  if (record.failed !== undefined) {
    if (typeof record.failed !== "boolean") return undefined;
    safe.failed = record.failed;
  }
  if (safe.event.startsWith("child_event")) {
    if (safe.phase !== "judge" || !integer(record.sequence, 1, 513)) return undefined;
    safe.sequence = record.sequence;
    if (safe.event === "child_event") {
      if (!childEvents.has(record.childEvent as string)) return undefined;
      safe.childEvent = record.childEvent as string;
      if (safe.childEvent.startsWith("item.")) {
        if (!childItems.has(record.childItem as string)) return undefined;
        safe.childItem = record.childItem as string;
        if (record.childState !== undefined) {
          if (!childStates.has(record.childState as string)) return undefined;
          safe.childState = record.childState as string;
        }
      }
    }
  }
  return safe;
}

export function createClawScanProgressCollector(emit: (event: SafeClawScanProgress) => void) {
  const decoder = new StringDecoder("utf8");
  let line = "";
  let oversized = false;
  const counts = { retained: 0, rejected: 0, limited: 0 };
  const finishLine = () => {
    const safe = oversized ? undefined : parseClawScanProgress(line);
    if (!safe) counts.rejected += 1;
    else if (counts.retained >= 2048) counts.limited += 1;
    else {
      emit(safe);
      counts.retained += 1;
    }
    line = "";
    oversized = false;
  };
  const consume = (text: string) => {
    for (const fragment of text.split(/(?<=\n)/)) {
      if (!oversized) {
        if (Buffer.byteLength(line) + Buffer.byteLength(fragment) > 8192) {
          oversized = true;
          line = "";
        } else line += fragment;
      }
      if (fragment.endsWith("\n")) finishLine();
    }
  };
  return {
    counts,
    write: (chunk: Buffer) => consume(decoder.write(chunk)),
    end: () => {
      consume(decoder.end());
      if (line || oversized) finishLine();
    },
  };
}
