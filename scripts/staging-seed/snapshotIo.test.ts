import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { readSelectedSnapshotEntries } from "./snapshotIo";

const workDirs: string[] = [];

afterEach(async () => {
  await Promise.all(workDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("readSelectedSnapshotEntries", () => {
  it("streams only selected files from a ZIP archive", async () => {
    const snapshot = await writeSnapshot({
      "_storage/kgone.txt": "one",
      "_storage/kgtwo.txt": "two",
      "skills/documents.jsonl": "{}\n",
    });
    const selected = new Map<string, string>();

    for await (const { entry, bytes } of readSelectedSnapshotEntries(
      snapshot,
      new Set(["_storage/kgone.txt", "_storage/kgtwo.txt"]),
    )) {
      selected.set(entry, bytes.toString("utf8"));
    }

    expect(selected).toEqual(
      new Map([
        ["_storage/kgone.txt", "one"],
        ["_storage/kgtwo.txt", "two"],
      ]),
    );
  });

  it("fails when a selected entry is missing", async () => {
    const snapshot = await writeSnapshot({ "_storage/kgone.txt": "one" });

    await expect(
      collect(readSelectedSnapshotEntries(snapshot, new Set(["_storage/kgmissing.txt"]))),
    ).rejects.toThrow("Snapshot is missing 1 selected entries");
  });
});

async function writeSnapshot(files: Record<string, string>) {
  const workDir = await mkdtemp(join(tmpdir(), "clawhub-snapshot-io-test-"));
  workDirs.push(workDir);
  const snapshot = join(workDir, "snapshot.zip");
  await writeFile(
    snapshot,
    zipSync(
      Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])),
    ),
  );
  return snapshot;
}

async function collect<T>(values: AsyncIterable<T>) {
  const output: T[] = [];
  for await (const value of values) output.push(value);
  return output;
}
