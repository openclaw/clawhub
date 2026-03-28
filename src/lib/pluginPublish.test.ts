/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME_PATTERN,
  extractSourceRepo,
  getString,
  getStringList,
  isRecord,
  normalizeGitHubRepo,
} from "./pluginPublish";

describe("PACKAGE_NAME_PATTERN", () => {
  it("accepts simple unscoped names", () => {
    expect(PACKAGE_NAME_PATTERN.test("demo-plugin")).toBe(true);
    expect(PACKAGE_NAME_PATTERN.test("openclaw")).toBe(true);
    expect(PACKAGE_NAME_PATTERN.test("my.plugin")).toBe(true);
  });

  it("accepts scoped names", () => {
    expect(PACKAGE_NAME_PATTERN.test("@scope/demo-plugin")).toBe(true);
    expect(PACKAGE_NAME_PATTERN.test("@openclaw/matrix")).toBe(true);
  });

  it("rejects uppercase letters", () => {
    expect(PACKAGE_NAME_PATTERN.test("Demo-Plugin")).toBe(false);
    expect(PACKAGE_NAME_PATTERN.test("@Scope/demo")).toBe(false);
  });

  it("rejects names starting with a hyphen", () => {
    expect(PACKAGE_NAME_PATTERN.test("-demo")).toBe(false);
    expect(PACKAGE_NAME_PATTERN.test("@scope/-demo")).toBe(false);
  });

  it("rejects empty strings and bare scope-only strings", () => {
    expect(PACKAGE_NAME_PATTERN.test("")).toBe(false);
    expect(PACKAGE_NAME_PATTERN.test("@scope/")).toBe(false);
  });
});

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for arrays, primitives, and null", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("getString", () => {
  it("trims and returns string values", () => {
    expect(getString("  hello  ")).toBe("hello");
    expect(getString("value")).toBe("value");
  });

  it("returns undefined for empty, whitespace-only, and non-string values", () => {
    expect(getString("")).toBeUndefined();
    expect(getString("   ")).toBeUndefined();
    expect(getString(null)).toBeUndefined();
    expect(getString(42)).toBeUndefined();
    expect(getString(undefined)).toBeUndefined();
  });
});

describe("getStringList", () => {
  it("maps and filters an array of strings", () => {
    expect(getStringList(["desktop", " mobile ", ""])).toEqual(["desktop", "mobile"]);
  });

  it("splits a comma-separated string", () => {
    expect(getStringList("desktop, mobile, ")).toEqual(["desktop", "mobile"]);
  });

  it("returns empty array for unrecognised types", () => {
    expect(getStringList(null)).toEqual([]);
    expect(getStringList(42)).toEqual([]);
    expect(getStringList({})).toEqual([]);
  });
});

describe("normalizeGitHubRepo", () => {
  it("keeps owner/repo shorthands as-is", () => {
    expect(normalizeGitHubRepo("openclaw/demo-plugin")).toBe("openclaw/demo-plugin");
    expect(normalizeGitHubRepo("QVerisAI/openclaw-qveris-plugin")).toBe(
      "QVerisAI/openclaw-qveris-plugin",
    );
  });

  it("extracts owner/repo from full HTTPS GitHub URLs", () => {
    expect(normalizeGitHubRepo("https://github.com/openclaw/demo-plugin")).toBe(
      "openclaw/demo-plugin",
    );
    expect(normalizeGitHubRepo("https://www.github.com/openclaw/demo-plugin")).toBe(
      "openclaw/demo-plugin",
    );
    expect(normalizeGitHubRepo("https://github.com/openclaw/demo-plugin/")).toBe(
      "openclaw/demo-plugin",
    );
  });

  it("strips trailing .git suffix", () => {
    expect(normalizeGitHubRepo("https://github.com/openclaw/demo-plugin.git")).toBe(
      "openclaw/demo-plugin",
    );
    expect(normalizeGitHubRepo("openclaw/demo-plugin.git")).toBe("openclaw/demo-plugin");
  });

  it("converts SSH git@github.com: format to HTTPS and extracts owner/repo", () => {
    expect(normalizeGitHubRepo("git@github.com:openclaw/demo-plugin.git")).toBe(
      "openclaw/demo-plugin",
    );
    expect(normalizeGitHubRepo("git@github.com:QVerisAI/openclaw-qveris-plugin.git")).toBe(
      "QVerisAI/openclaw-qveris-plugin",
    );
  });

  it("strips git+ prefix", () => {
    expect(normalizeGitHubRepo("git+https://github.com/openclaw/demo-plugin.git")).toBe(
      "openclaw/demo-plugin",
    );
  });

  it("returns undefined for non-GitHub URLs", () => {
    expect(normalizeGitHubRepo("https://gitlab.com/owner/repo")).toBeUndefined();
    expect(normalizeGitHubRepo("https://bitbucket.org/owner/repo")).toBeUndefined();
  });

  it("returns undefined for GitHub URLs missing an owner or repo segment", () => {
    expect(normalizeGitHubRepo("https://github.com/only-owner")).toBeUndefined();
    expect(normalizeGitHubRepo("https://github.com/")).toBeUndefined();
  });

  it("returns undefined for blank input", () => {
    expect(normalizeGitHubRepo("")).toBeUndefined();
    expect(normalizeGitHubRepo("   ")).toBeUndefined();
  });

  it("ignores deep sub-paths and keeps only owner/repo", () => {
    expect(normalizeGitHubRepo("https://github.com/openclaw/demo-plugin/tree/main")).toBe(
      "openclaw/demo-plugin",
    );
  });
});

describe("extractSourceRepo", () => {
  it("returns undefined for null package.json", () => {
    expect(extractSourceRepo(null)).toBeUndefined();
  });

  it("reads a string repository field", () => {
    expect(extractSourceRepo({ repository: "openclaw/demo-plugin" })).toBe("openclaw/demo-plugin");
    expect(extractSourceRepo({ repository: "https://github.com/openclaw/demo-plugin" })).toBe(
      "openclaw/demo-plugin",
    );
  });

  it("reads a repository object with a url field", () => {
    expect(
      extractSourceRepo({
        repository: {
          type: "git",
          url: "git+https://github.com/openclaw/demo-plugin.git",
        },
      }),
    ).toBe("openclaw/demo-plugin");
  });

  it("falls back to homepage when repository is absent", () => {
    expect(
      extractSourceRepo({ homepage: "https://github.com/openclaw/demo-plugin" }),
    ).toBe("openclaw/demo-plugin");
  });

  it("falls back to bugs.url when repository and homepage are absent", () => {
    expect(
      extractSourceRepo({ bugs: { url: "https://github.com/openclaw/demo-plugin/issues" } }),
    ).toBe("openclaw/demo-plugin");
  });

  it("prefers repository over homepage and bugs.url", () => {
    expect(
      extractSourceRepo({
        repository: "openclaw/primary",
        homepage: "https://github.com/openclaw/homepage",
        bugs: { url: "https://github.com/openclaw/bugs" },
      }),
    ).toBe("openclaw/primary");
  });

  it("prefers homepage over bugs.url when repository is absent", () => {
    expect(
      extractSourceRepo({
        homepage: "https://github.com/openclaw/homepage",
        bugs: { url: "https://github.com/openclaw/bugs" },
      }),
    ).toBe("openclaw/homepage");
  });

  it("returns undefined when no recognised field contains a GitHub URL", () => {
    expect(extractSourceRepo({ name: "@openclaw/demo-plugin", version: "1.0.0" })).toBeUndefined();
    expect(
      extractSourceRepo({ repository: { type: "git", url: "https://gitlab.com/owner/repo.git" } }),
    ).toBeUndefined();
  });
});
