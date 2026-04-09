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

  it("normalize uses lowercase", () => {
    expect(__test.normalize("AbC")).toBe("abc");
  });

  // CJK (Chinese, Japanese, Korean) support tests
  describe("CJK tokenization", () => {
    it("tokenizes Chinese text using Intl.Segmenter", () => {
      const tokens = tokenize("中文搜索");
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens).toContain("中文");
      expect(tokens).toContain("搜索");
    });

    it("tokenizes mixed Chinese and English text", () => {
      const tokens = tokenize("React 组件开发");
      expect(tokens).toContain("react");
      expect(tokens.some((t) => t.includes("组") || t.includes("件"))).toBe(true);
    });

    it("matches Chinese query tokens against Chinese skill names", () => {
      const queryTokens = tokenize("翻译");
      const skillName = "AI翻译助手";
      expect(matchesExactTokens(queryTokens, [skillName])).toBe(true);
    });

    it("matches partial Chinese words", () => {
      const queryTokens = tokenize("助手");
      const skillName = "AI翻译助手";
      expect(matchesExactTokens(queryTokens, [skillName])).toBe(true);
    });

    it("handles Japanese text", () => {
      const tokens = tokenize("こんにちは世界");
      expect(tokens.length).toBeGreaterThan(0);
    });

    it("handles Korean text", () => {
      const tokens = tokenize("안녕하세요");
      expect(tokens.length).toBeGreaterThan(0);
    });

    it("returns empty array for empty or whitespace-only input", () => {
      expect(tokenize("")).toEqual([]);
      expect(tokenize("   ")).toEqual([]);
      expect(tokenize("!!!")).toEqual([]);
    });

    it("detects CJK language correctly", () => {
      expect(__test.detectCJKLanguage("中文")).toBe("zh");
      expect(__test.detectCJKLanguage("こんにちは")).toBe("ja");
      expect(__test.detectCJKLanguage("안녕하세요")).toBe("ko");
      expect(__test.detectCJKLanguage("hello")).toBeNull();
    });
  });
});
