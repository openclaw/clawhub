import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { openPromise } from "yauzl";
import type { SnapshotDocument } from "./snapshotPolicy";

export async function* readSnapshotTable(
  snapshotPath: string,
  table: string,
): AsyncGenerator<SnapshotDocument> {
  const child = spawn("unzip", ["-p", snapshotPath, `${table}/documents.jsonl`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const errors: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  const completion = childCompletion(child);
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  let completed = false;
  try {
    for await (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as SnapshotDocument;
    }
    completed = true;
  } finally {
    if (!completed && child.exitCode === null) child.kill("SIGTERM");
  }
  const status = await completion;
  if (completed && status !== 0) {
    throw new Error(
      `Failed to read ${table} from snapshot: ${Buffer.concat(errors).toString("utf8").trim()}`,
    );
  }
}

export async function readSnapshotEntry(snapshotPath: string, entry: string) {
  const child = spawn("unzip", ["-p", snapshotPath, entry], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  const errors: Buffer[] = [];
  const completion = childCompletion(child);
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  const status = await completion;
  if (status !== 0) {
    throw new Error(
      `Failed to read ${entry} from snapshot: ${Buffer.concat(errors).toString("utf8").trim()}`,
    );
  }
  return Buffer.concat(chunks);
}

export async function* readSelectedSnapshotEntries(
  snapshotPath: string,
  selectedEntries: ReadonlySet<string>,
): AsyncGenerator<{ entry: string; bytes: Buffer }> {
  if (selectedEntries.size === 0) return;

  const found = new Set<string>();
  const zip = await openPromise(snapshotPath, { autoClose: false, lazyEntries: true });
  try {
    for await (const file of zip.eachEntry()) {
      if (!selectedEntries.has(file.fileName)) continue;
      if (!file.canDecodeFileData()) {
        throw new Error(`Cannot decode selected snapshot entry: ${file.fileName}`);
      }
      const stream = await zip.openReadStreamPromise(file);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      found.add(file.fileName);
      yield { entry: file.fileName, bytes: Buffer.concat(chunks) };
    }
  } finally {
    zip.close();
  }

  const missing = [...selectedEntries].filter((entry) => !found.has(entry));
  if (missing.length > 0) {
    throw new Error(`Snapshot is missing ${missing.length} selected entries`);
  }
}

export async function listSelectedStorageEntries(
  snapshotPath: string,
  storageIds: ReadonlySet<string>,
) {
  const entries = new Map<string, string>();
  for await (const entry of listSnapshotEntries(snapshotPath)) {
    if (!entry.startsWith("_storage/") || entry.endsWith("/documents.jsonl")) continue;
    const basename = entry.slice("_storage/".length);
    const storageId = basename.includes(".") ? basename.slice(0, basename.indexOf(".")) : basename;
    if (storageIds.has(storageId)) entries.set(storageId, entry);
  }
  return entries;
}

export async function* listSnapshotEntries(snapshotPath: string) {
  const child = spawn("unzip", ["-Z1", snapshotPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const errors: Buffer[] = [];
  const completion = childCompletion(child);
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const entry of lines) yield entry;
  const status = await completion;
  if (status !== 0) {
    throw new Error(`Failed to list snapshot: ${Buffer.concat(errors).toString("utf8").trim()}`);
  }
}

export async function runCommand(command: string, args: string[], cwd?: string) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
  });
  const status = await childCompletion(child);
  if (status !== 0) throw new Error(`${command} exited with status ${status ?? "unknown"}`);
}

function childCompletion(child: ReturnType<typeof spawn>) {
  return new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}
