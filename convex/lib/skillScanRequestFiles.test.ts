import { describe, expect, it } from "vitest";
import { chunkSkillScanRequestFiles } from "./skillScanRequestFiles";

function file(path: string) {
  return {
    path,
    size: 1,
    storageId: "storage:1" as never,
    sha256: "a".repeat(64),
  };
}

describe("chunkSkillScanRequestFiles", () => {
  it("caps each action-to-mutation handoff at 100 file descriptors", () => {
    const chunks = chunkSkillScanRequestFiles(
      Array.from({ length: 205 }, (_, index) => file(`files/${index}.txt`)),
    );

    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 5]);
  });

  it("caps each action-to-mutation handoff at 256 KiB of serialized metadata", () => {
    const chunks = chunkSkillScanRequestFiles([
      file(`files/${"a".repeat(132_000)}.txt`),
      file(`files/${"b".repeat(132_000)}.txt`),
    ]);

    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(JSON.stringify(chunk)).byteLength).toBeLessThanOrEqual(
        256 * 1024,
      );
    }
  });

  it("rejects manifests whose total serialized metadata exceeds the worker hydration budget", () => {
    const files = Array.from({ length: 34 }, (_, index) =>
      file(`files/${String(index).padStart(2, "0")}-${"a".repeat(128_000)}.txt`),
    );

    expect(() => chunkSkillScanRequestFiles(files)).toThrow(/manifest metadata exceeds/i);
  });
});
