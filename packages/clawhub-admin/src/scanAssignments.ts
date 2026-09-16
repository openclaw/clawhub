// The priority worker never receives bulk assignments. Change pool sizes only
// after previous shared workers drain: shard ownership depends on pool size.
function validateSharedWorkers(count: number) {
  if (count !== 9 && count !== 18) throw new Error("Shared worker count must be 9 or 18");
}
const MAX_JOBS_PER_SHARD = 512;
const MAX_JOBS_PER_DISPATCH = 1728;

// Only bound local input shape/size. The backend v.id validator is authoritative
// for the table and encoding; Convex IDs do not have a fixed string length.
function readJobIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id))
  ) {
    throw new Error("Expected a JSON array of securityScanJobs IDs from saved admission receipts");
  }
  return value;
}

function parseAssignments(raw: string, sharedWorkers: number): string[][] {
  validateSharedWorkers(sharedWorkers);
  if (raw.length > 65_000) throw new Error("Worker assignments exceed the workflow input budget");
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length !== sharedWorkers) {
    throw new Error(
      `Expected exactly ${sharedWorkers === 9 ? "nine" : "eighteen"} shared worker assignments`,
    );
  }
  const assignments = value.map(readJobIds);
  const ids = assignments.flat();
  if (assignments.some((part) => part.length > MAX_JOBS_PER_SHARD)) {
    throw new Error("At most 512 job IDs may be assigned to each shared worker");
  }
  if (new Set(ids).size !== ids.length)
    throw new Error("Worker assignments contain duplicate job IDs");
  return assignments;
}

export function planScanWorkers(value: unknown, batchLimit: number, sharedWorkers = 9) {
  validateSharedWorkers(sharedWorkers);
  const ids = readJobIds(value);
  if (ids.length === 0 || ids.length > 10_000) {
    throw new Error("Supply 1–10000 admitted job IDs; overflow is returned for later dispatches");
  }
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 512) {
    throw new Error("Batch limit must be an integer between 1 and 512");
  }
  if (new Set(ids).size !== ids.length) throw new Error("Input contains duplicate job IDs");
  const deferredJobIds: string[] = [];
  let assignedCount = 0;
  // Include JSON escaping of the assignment string and reserve space for the
  // workflow input keys. IDs are opaque; longer IDs reduce this dispatch's size.
  let inputBytes = 200;
  const assignments: string[][] = Array.from({ length: sharedWorkers }, () => []);
  for (const id of ids) {
    // Stable ownership across overlapping workflow runs: removing completed IDs
    // must not move another job onto a different shard that is already running.
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    const shard = assignments[hash % sharedWorkers];
    const encodedBytes = id.length + 5;
    if (
      shard.length === MAX_JOBS_PER_SHARD ||
      assignedCount === MAX_JOBS_PER_DISPATCH ||
      inputBytes + encodedBytes > 65_000
    ) {
      deferredJobIds.push(id);
    } else {
      shard.push(id);
      assignedCount++;
      inputBytes += encodedBytes;
    }
  }
  const raw = JSON.stringify(assignments);
  parseAssignments(raw, sharedWorkers);
  return {
    inputs: {
      "assigned-jobs": raw,
      "batch-limit": String(batchLimit),
      "shared-workers": String(sharedWorkers),
      "max-runtime-minutes": "12",
    },
    deferredJobIds,
  };
}

export function readWorkerAssignment(
  raw: string | undefined,
  lane: string,
  shard: string | undefined,
  sharedWorkers = 9,
): string[] | undefined {
  if (!raw) return undefined;
  if (lane === "priority" && shard === "priority-0") return undefined;
  const assignments = parseAssignments(raw, sharedWorkers);
  const index = Number(shard?.match(/^shared-(0|[1-9]\d*)$/)?.[1] ?? Number.NaN);
  if (lane !== "shared" || !Number.isInteger(index) || index >= sharedWorkers) {
    throw new Error(
      `Bulk assignments require a shared-0 through shared-${sharedWorkers - 1} worker`,
    );
  }
  return assignments[index];
}
