import { describe, expect, it } from "vitest";
import { buildGitHubFolderContentHash, hashFileInventory } from "./fileInventory.js";

describe("file inventory", () => {
  it("preserves file order and hashes only each byte view", () => {
    const bytes = new Uint8Array([9, 1, 2, 3, 9]);

    expect(
      hashFileInventory([
        { relPath: "z.txt", bytes: bytes.subarray(1, 4) },
        { relPath: "é.txt", bytes: new TextEncoder().encode("é") },
        { relPath: "empty.txt", bytes: new Uint8Array() },
      ]),
    ).toEqual([
      {
        path: "z.txt",
        sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
        size: 3,
      },
      {
        path: "é.txt",
        sha256: "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",
        size: 2,
      },
      {
        path: "empty.txt",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        size: 0,
      },
    ]);
  });

  it("retains the folder digest format without sorting the input in place", () => {
    const files = [
      { path: "b.txt", sha256: "B".repeat(64), size: 0 },
      { path: "a.txt", sha256: "A".repeat(64), size: 2 },
    ];

    expect(buildGitHubFolderContentHash(files)).toBe(
      "c2ab3e0ba402eeed5d17ad1a64583a1bd34ac509c2034d29ec256be3afe4a264",
    );
    expect(files.map((file) => file.path)).toEqual(["b.txt", "a.txt"]);
  });
});
