/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { buildReadmeAssetBaseUrl } from "./readmeAssetBaseUrl";

const SHA = "abcdef0123456789abcdef0123456789abcdef01";

describe("buildReadmeAssetBaseUrl", () => {
  it("builds a raw.githubusercontent.com base from owner/repo + commit SHA", () => {
    expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA)).toBe(
      `https://raw.githubusercontent.com/openclaw/demo/${SHA}/`,
    );
  });

  it("normalizes a full GitHub HTTPS URL down to owner/repo", () => {
    expect(buildReadmeAssetBaseUrl("https://github.com/openclaw/demo", SHA)).toBe(
      `https://raw.githubusercontent.com/openclaw/demo/${SHA}/`,
    );
  });

  it("strips a trailing .git suffix on the source repo", () => {
    expect(buildReadmeAssetBaseUrl("https://github.com/openclaw/demo.git", SHA)).toBe(
      `https://raw.githubusercontent.com/openclaw/demo/${SHA}/`,
    );
    expect(buildReadmeAssetBaseUrl("openclaw/demo.git", SHA)).toBe(
      `https://raw.githubusercontent.com/openclaw/demo/${SHA}/`,
    );
  });

  it("returns undefined for non-GitHub source URLs", () => {
    expect(buildReadmeAssetBaseUrl("https://gitlab.com/openclaw/demo", SHA)).toBeUndefined();
  });

  it("returns undefined when sourceCommit is missing or not a 40-hex SHA", () => {
    expect(buildReadmeAssetBaseUrl("openclaw/demo", undefined)).toBeUndefined();
    expect(buildReadmeAssetBaseUrl("openclaw/demo", "")).toBeUndefined();
    expect(buildReadmeAssetBaseUrl("openclaw/demo", "main")).toBeUndefined();
    expect(buildReadmeAssetBaseUrl("openclaw/demo", "v1.2.3")).toBeUndefined();
    expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA.slice(0, 10))).toBeUndefined();
  });

  it("returns undefined when sourceRepo is missing or malformed", () => {
    expect(buildReadmeAssetBaseUrl(undefined, SHA)).toBeUndefined();
    expect(buildReadmeAssetBaseUrl("", SHA)).toBeUndefined();
    expect(buildReadmeAssetBaseUrl("not-a-repo", SHA)).toBeUndefined();
    expect(buildReadmeAssetBaseUrl("too/many/parts/here", SHA)).toBeUndefined();
  });

  describe("with sourcePath", () => {
    it("appends a single subdirectory after the commit SHA", () => {
      expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA, "examples/openclaw-plugin")).toBe(
        `https://raw.githubusercontent.com/openclaw/demo/${SHA}/examples/openclaw-plugin/`,
      );
    });

    it("strips a leading or trailing slash on sourcePath", () => {
      expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA, "/pkg/")).toBe(
        `https://raw.githubusercontent.com/openclaw/demo/${SHA}/pkg/`,
      );
    });

    it("treats '.' and empty path as repo root (no path segment)", () => {
      expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA, ".")).toBe(
        `https://raw.githubusercontent.com/openclaw/demo/${SHA}/`,
      );
      expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA, "")).toBe(
        `https://raw.githubusercontent.com/openclaw/demo/${SHA}/`,
      );
      expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA, undefined)).toBe(
        `https://raw.githubusercontent.com/openclaw/demo/${SHA}/`,
      );
    });

    it("returns undefined when sourcePath contains '..' or other unsafe segments", () => {
      expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA, "../etc/passwd")).toBeUndefined();
      expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA, "pkg/../escape")).toBeUndefined();
      expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA, "pkg/with space")).toBeUndefined();
      expect(buildReadmeAssetBaseUrl("openclaw/demo", SHA, "pkg\\windows")).toBeUndefined();
    });

    it("ignores sourcePath when sourceRepo or sourceCommit is invalid", () => {
      expect(
        buildReadmeAssetBaseUrl("not-a-repo", SHA, "examples/openclaw-plugin"),
      ).toBeUndefined();
      expect(
        buildReadmeAssetBaseUrl("openclaw/demo", "main", "examples/openclaw-plugin"),
      ).toBeUndefined();
    });
  });
});
