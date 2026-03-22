/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { __test, matchesExactTokens, tokenize } from "./searchText";

describe("searchText", () => {
  it("tokenize lowercases and splits on punctuation", () => {
    expect(tokenize("Minimax Usage /minimax-usage")).toEqual([
      "minimax",
      "usage",
      "minimax",
      "usage",
    ]);
  });

  it("tokenize splits ASCII tokens on underscores and dots like legacy regex", () => {
    expect(tokenize("hello_world")).toEqual(["hello", "world"]);
    expect(tokenize("foo.bar")).toEqual(["foo", "bar"]);
    expect(tokenize("SKILL.md")).toEqual(["skill", "md"]);
  });

  it("tokenize handles CJK characters with Intl.Segmenter", () => {
    const tokens = tokenize("视频生成");
    expect(tokens.length).toBeGreaterThan(0);
    // Should contain Chinese word segments, not be empty
    expect(tokens.some((t) => /[\u4e00-\u9fff]/.test(t))).toBe(true);
  });

  it("tokenize handles mixed CJK and ASCII", () => {
    const tokens = tokenize("AI视频生成");
    expect(tokens.some((t) => t === "ai")).toBe(true);
    expect(tokens.some((t) => /[\u4e00-\u9fff]/.test(t))).toBe(true);
  });

  it("tokenize returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(null as unknown as string)).toEqual([]);
  });

  it("tokenizeAscii only returns ASCII tokens", () => {
    expect(__test.tokenizeAscii("AI视频生成tool")).toEqual(["ai", "tool"]);
    expect(__test.tokenizeAscii("视频生成")).toEqual([]);
  });

  it("matchesExactTokens requires at least one query token to prefix-match", () => {
    const queryTokens = tokenize("Remind Me");
    expect(matchesExactTokens(queryTokens, ["Remind Me", "/remind-me", "Short summary"])).toBe(
      true,
    );
    // "Reminder" starts with "remind", so it matches with prefix matching
    expect(matchesExactTokens(queryTokens, ["Reminder tool", "/reminder", "Short summary"])).toBe(
      true,
    );
    // Matches because "remind" token is present
    expect(matchesExactTokens(queryTokens, ["Remind tool", "/remind", "Short summary"])).toBe(true);
    // No matching tokens at all
    expect(matchesExactTokens(queryTokens, ["Other tool", "/other", "Short summary"])).toBe(false);
  });

  it("matchesExactTokens supports prefix matching for partial queries", () => {
    // "go" should match "gohome" because "gohome" starts with "go"
    expect(matchesExactTokens(["go"], ["GoHome", "/gohome", "Navigate home"])).toBe(true);
    // "pad" should match "padel"
    expect(matchesExactTokens(["pad"], ["Padel", "/padel", "Tennis-like sport"])).toBe(true);
    // "xyz" should not match anything
    expect(matchesExactTokens(["xyz"], ["GoHome", "/gohome", "Navigate home"])).toBe(false);
    // "notion" should not match "annotations" (substring only)
    expect(matchesExactTokens(["notion"], ["Annotations helper", "/annotations"])).toBe(false);
  });

  it("matchesExactTokens ignores empty inputs", () => {
    expect(matchesExactTokens([], ["text"])).toBe(false);
    expect(matchesExactTokens(["token"], ["  ", null, undefined])).toBe(false);
  });

  it("matchesExactTokens works with CJK tokens when skill metadata contains CJK", () => {
    const queryTokens = tokenize("视频生成");
    // Skill with Chinese in displayName should match
    expect(matchesExactTokens(queryTokens, ["视频生成工具", "video-gen", "Generate videos"])).toBe(
      true,
    );
    // Skill with only English metadata should NOT match via token filter
    expect(
      matchesExactTokens(queryTokens, [
        "Video Generation",
        "video-generation",
        "Generate videos",
      ]),
    ).toBe(false);
  });

  it("normalize strips accents", () => {
    expect(__test.normalize("Café")).toBe("cafe");
    expect(__test.normalize("Pokémon")).toBe("pokemon");
    expect(__test.normalize("AbC")).toBe("abc");
  });

  it("tokenize handles accented Latin as ASCII after normalization", () => {
    expect(tokenize("café")).toEqual(["cafe"]);
    expect(tokenize("pokémon")).toEqual(["pokemon"]);
    // Should match ASCII metadata via prefix
    expect(matchesExactTokens(tokenize("pokémon"), ["Pokemon Helper", "pokemon-helper"])).toBe(true);
  });

  it("tokenize splits mixed-script tokens into ASCII and non-ASCII parts", () => {
    const tokens = tokenize("AI绘画");
    expect(tokens).toContain("ai");
    expect(tokens.some((t) => /[\u4e00-\u9fff]/.test(t))).toBe(true);
  });

  it("isAsciiToken correctly identifies ASCII-only tokens", () => {
    expect(__test.isAsciiToken("hello")).toBe(true);
    expect(__test.isAsciiToken("abc123")).toBe(true);
    expect(__test.isAsciiToken("视频")).toBe(false);
    expect(__test.isAsciiToken("ai视频")).toBe(false);
    expect(__test.isAsciiToken("café")).toBe(false); // raw, pre-normalize
  });

  it("partitionQueryTokens separates ASCII and non-ASCII tokens", () => {
    const mixed = tokenize("AI视频生成tool");
    const { ascii, nonAscii } = __test.partitionQueryTokens(mixed);
    expect(ascii).toContain("ai");
    expect(ascii).toContain("tool");
    expect(nonAscii.length).toBeGreaterThan(0);
    expect(nonAscii.every((t) => !/^[a-z0-9]+$/.test(t))).toBe(true);
  });

  it("partitionQueryTokens returns all ASCII for English-only query", () => {
    const tokens = tokenize("video generation");
    const { ascii, nonAscii } = __test.partitionQueryTokens(tokens);
    expect(ascii).toEqual(["video", "generation"]);
    expect(nonAscii).toEqual([]);
  });

  it("partitionQueryTokens returns all non-ASCII for CJK-only query", () => {
    const tokens = tokenize("视频生成");
    const { ascii, nonAscii } = __test.partitionQueryTokens(tokens);
    expect(ascii).toEqual([]);
    expect(nonAscii.length).toBeGreaterThan(0);
  });
});
