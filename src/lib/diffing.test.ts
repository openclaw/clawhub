import { describe, expect, it } from "vitest";
import {
  buildFileDiffList,
  getDefaultDiffSelection,
  resolveLatestVersionId,
  resolvePreviousVersionId,
  selectDefaultFilePath,
  sortVersionsBySemver,
} from "./diffing";

describe("diffing", () => {
  it("sorts versions by semver descending", () => {
    const ordered = sortVersionsBySemver([
      { id: "a", version: "1.0.0" },
      { id: "b", version: "2.0.0" },
      { id: "c", version: "1.5.0" },
    ]);
    expect(ordered.map((entry) => entry.version)).toEqual(["2.0.0", "1.5.0", "1.0.0"]);
  });

  it("sorts valid semver ahead of invalid entries", () => {
    const ordered = sortVersionsBySemver([
      { id: "a", version: "not-a-version" },
      { id: "b", version: "1.0.0" },
      { id: "c", version: "2.0.0" },
    ]);
    expect(ordered.map((entry) => entry.version)).toEqual(["2.0.0", "1.0.0", "not-a-version"]);
  });

  it("sorts when only one entry is valid", () => {
    const ordered = sortVersionsBySemver([
      { id: "a", version: "nope" },
      { id: "b", version: "1.0.0" },
    ]);
    expect(ordered.map((entry) => entry.version)).toEqual(["1.0.0", "nope"]);
  });

  it("sorts invalid entries lexicographically", () => {
    const ordered = sortVersionsBySemver([
      { id: "a", version: "beta" },
      { id: "b", version: "alpha" },
    ]);
    expect(ordered.map((entry) => entry.version)).toEqual(["alpha", "beta"]);
  });

  it("resolves latest from tag when present", () => {
    const latestId = resolveLatestVersionId(
      [
        { id: "a", version: "1.0.0" },
        { id: "b", version: "2.0.0" },
      ],
      { latest: "a" },
    );
    expect(latestId).toBe("a");
  });

  it("returns null when no versions exist", () => {
    const latestId = resolveLatestVersionId([], undefined);
    expect(latestId).toBeNull();
  });

  it("resolves previous via semver predecessor", () => {
    const latestId = "b";
    const previousId = resolvePreviousVersionId(
      [
        { id: "a", version: "1.0.0" },
        { id: "b", version: "2.0.0" },
        { id: "c", version: "1.5.0" },
      ],
      latestId,
    );
    expect(previousId).toBe("c");
  });

  it("falls back to second entry when latest missing", () => {
    const previousId = resolvePreviousVersionId(
      [
        { id: "a", version: "2.0.0" },
        { id: "b", version: "1.0.0" },
        { id: "c", version: "0.5.0" },
      ],
      "missing",
    );
    expect(previousId).toBe("b");
  });

  it("returns default selection previous vs latest", () => {
    const selection = getDefaultDiffSelection(
      [
        { id: "a", version: "1.0.0" },
        { id: "b", version: "2.0.0" },
      ],
      { latest: "b" },
    );
    expect(selection).toEqual({ leftId: "a", rightId: "b" });
  });

  it("builds file diff list with statuses", () => {
    const diff = buildFileDiffList(
      [
        { path: "SKILL.md", sha256: "aaa", size: 10 },
        { path: "a.ts", sha256: "bbb", size: 10 },
      ],
      [
        { path: "SKILL.md", sha256: "aaa", size: 10 },
        { path: "b.ts", sha256: "ccc", size: 10 },
        { path: "a.ts", sha256: "ddd", size: 10 },
      ],
    );
    const statusByPath = Object.fromEntries(diff.map((item) => [item.path, item.status]));
    expect(statusByPath["SKILL.md"]).toBe("same");
    expect(statusByPath["a.ts"]).toBe("changed");
    expect(statusByPath["b.ts"]).toBe("added");
  });

  it("orders file diff list by change status then path", () => {
    const diff = buildFileDiffList(
      [
        { path: "c.txt", sha256: "aaa", size: 1 },
        { path: "a.txt", sha256: "bbb", size: 1 },
      ],
      [
        { path: "a.txt", sha256: "ccc", size: 1 },
        { path: "b.txt", sha256: "ddd", size: 1 },
      ],
    );
    expect(diff.map((item) => item.path)).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("orders file diff list alphabetically for same status", () => {
    const diff = buildFileDiffList(
      [
        { path: "b.txt", sha256: "aaa", size: 1 },
        { path: "a.txt", sha256: "bbb", size: 1 },
      ],
      [
        { path: "b.txt", sha256: "aaa", size: 1 },
        { path: "a.txt", sha256: "bbb", size: 1 },
      ],
    );
    expect(diff.map((item) => item.path)).toEqual(["a.txt", "b.txt"]);
  });

  it("selects SKILL.md as default file when present", () => {
    const path = selectDefaultFilePath([
      { path: "notes.md", status: "changed" },
      { path: "SKILL.md", status: "same" },
    ]);
    expect(path).toBe("SKILL.md");
  });

  it("falls back to first changed file when SKILL.md missing", () => {
    const path = selectDefaultFilePath([
      { path: "alpha.txt", status: "same" },
      { path: "beta.txt", status: "changed" },
    ]);
    expect(path).toBe("beta.txt");
  });

  it("returns null when no file entries exist", () => {
    expect(selectDefaultFilePath([])).toBeNull();
  });
});
