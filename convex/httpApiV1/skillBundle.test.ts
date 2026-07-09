import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_PUBLISH_FILE_BYTES } from "../lib/publishLimits";
import { extractSkillBundleEntries } from "./shared";

function zip(files: Record<string, Uint8Array>): Uint8Array {
  return Uint8Array.from(zipSync(files));
}

describe("extractSkillBundleEntries", () => {
  it("extracts files with paths, bytes, and size", () => {
    const bundle = zip({
      "SKILL.md": strToU8("# Title\n"),
      "src/index.js": strToU8("export const x = 1;\n"),
    });
    const entries = extractSkillBundleEntries(bundle).sort((a, b) => a.path.localeCompare(b.path));
    expect(entries.map((e) => e.path)).toEqual(["SKILL.md", "src/index.js"]);
    expect(entries[0].size).toBe("# Title\n".length);
    expect(new TextDecoder().decode(entries[1].bytes)).toBe("export const x = 1;\n");
  });

  it("skips mac junk entries", () => {
    const bundle = zip({
      "SKILL.md": strToU8("hi"),
      "__MACOSX/._SKILL.md": strToU8("junk"),
      ".DS_Store": strToU8("junk"),
    });
    const paths = extractSkillBundleEntries(bundle).map((e) => e.path);
    expect(paths).toEqual(["SKILL.md"]);
  });

  it("rejects a file over the per-file size limit", () => {
    const bundle = zip({
      "big.js": new Uint8Array(MAX_PUBLISH_FILE_BYTES + 1),
    });
    expect(() => extractSkillBundleEntries(bundle)).toThrow(/exceeds/i);
  });

  it("allows a file exactly at the per-file size limit", () => {
    const bundle = zip({ "edge.js": new Uint8Array(MAX_PUBLISH_FILE_BYTES) });
    const entries = extractSkillBundleEntries(bundle);
    expect(entries).toHaveLength(1);
    expect(entries[0].size).toBe(MAX_PUBLISH_FILE_BYTES);
  });

  it("throws on bytes that are not a valid zip", () => {
    expect(() => extractSkillBundleEntries(strToU8("not a zip"))).toThrow(/not a valid zip/i);
  });
});
