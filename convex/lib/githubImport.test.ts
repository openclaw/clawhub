/* @vitest-environment node */

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildGitHubZipForTests,
  computeDefaultSelectedPaths,
  detectGitHubImportCandidates,
  extractMarkdownRelativeTargets,
  fetchGitHubZipBytes,
  parseGitHubImportUrl,
  resolveGitHubCommit,
  resolveMarkdownTarget,
  stripGitHubZipRoot,
} from "./githubImport";

function requestInfoToUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;

  throw new Error("Unexpected fetch input type");
}

describe("github import", () => {
  it("parses repo root urls", () => {
    expect(parseGitHubImportUrl("https://github.com/visionik/ouracli")).toEqual({
      owner: "visionik",
      repo: "ouracli",
      originalUrl: "https://github.com/visionik/ouracli",
    });
  });

  it("rejects non-https and non-github urls", () => {
    expect(() => parseGitHubImportUrl("http://github.com/a/b")).toThrow(/https/i);
    expect(() => parseGitHubImportUrl("https://example.com/a/b")).toThrow(/github\.com/i);
    expect(() => parseGitHubImportUrl("not-a-url")).toThrow(/Invalid URL/i);
  });

  it("rejects malformed tree/blob urls", () => {
    expect(() => parseGitHubImportUrl("https://github.com/a/b/tree/")).toThrow(/Missing ref/i);
    expect(() => parseGitHubImportUrl("https://github.com/a/b/blob/main")).toThrow(/Missing path/i);
    expect(() => parseGitHubImportUrl("https://github.com/a/b/tree/main/bad%5cpath")).toThrow();
  });

  it("parses tree urls with ref and path", () => {
    expect(parseGitHubImportUrl("https://github.com/a/b/tree/main/skills/foo")).toEqual({
      owner: "a",
      repo: "b",
      ref: "main",
      path: "skills/foo",
      originalUrl: "https://github.com/a/b/tree/main/skills/foo",
    });
  });

  it("parses blob urls and derives folder path", () => {
    expect(parseGitHubImportUrl("https://github.com/a/b/blob/main/skills/foo/SKILL.md")).toEqual({
      owner: "a",
      repo: "b",
      ref: "main",
      path: "skills/foo",
      originalUrl: "https://github.com/a/b/blob/main/skills/foo/SKILL.md",
    });
  });

  it("strips single top-level folder from GitHub zip entries", () => {
    const zip = buildGitHubZipForTests({
      "repo-1/skill/SKILL.md": "Body",
      "repo-1/skill/a.txt": "a",
    });
    const stripped = stripGitHubZipRoot(unzipSync(zip));
    expect(Object.keys(stripped).sort()).toEqual(["skill/SKILL.md", "skill/a.txt"]);
  });

  it("keeps paths when zip has multiple top-level roots", () => {
    const zip = buildGitHubZipForTests({
      "a/SKILL.md": "Body",
      "b/SKILL.md": "Body",
    });
    const stripped = stripGitHubZipRoot(unzipSync(zip));
    expect(Object.keys(stripped).sort()).toEqual(["a/SKILL.md", "b/SKILL.md"]);
  });

  it("detects candidates in a GitHub zip and strips the root folder", () => {
    const zip = buildGitHubZipForTests({
      "ouracli-123/SKILL.md": `---\nname: demo\ndescription: Hello\n---\nBody`,
      "ouracli-123/src/index.ts": "export {}",
    });
    const stripped = stripGitHubZipRoot(unzipSync(zip));
    const candidates = detectGitHubImportCandidates(stripped);
    expect(candidates.map((c) => c.path)).toEqual([""]);
    expect(candidates[0]?.name).toBe("demo");
  });

  it("detects multiple candidates and supports skills.md", () => {
    const zip = buildGitHubZipForTests({
      "repo-1/alpha/SKILL.md": `---\nname: Alpha\n---\nBody`,
      "repo-1/beta/skills.md": `---\nname: Beta\n---\nBody`,
      "repo-1/readme.md": "x",
    });
    const stripped = stripGitHubZipRoot(unzipSync(zip));
    const candidates = detectGitHubImportCandidates(stripped);
    expect(candidates.map((c) => c.path)).toEqual(["alpha", "beta"]);
    expect(candidates.map((c) => c.name)).toEqual(["Alpha", "Beta"]);
  });

  it("computes default selection via markdown references", () => {
    const entries = {
      "skill/SKILL.md": `---\nname: demo\n---\nSee [usage](docs/usage.md) and ![logo](img/logo.svg).\nIgnore [web](https://example.com).`,
      "skill/docs/usage.md": `See [more](more.md)`,
      "skill/docs/more.md": `Ok`,
      "skill/img/logo.svg": `<svg/>`,
      "skill/extra.txt": "not referenced",
    };
    const zip = buildGitHubZipForTests(
      Object.fromEntries(Object.entries(entries).map(([k, v]) => [`repo-1/${k}`, v])),
    );
    const raw = unzipSync(zip);
    const stripped = stripGitHubZipRoot(raw);
    const candidates = detectGitHubImportCandidates(stripped);
    const candidate = candidates.find((c) => c.path === "skill");
    expect(candidate).toBeTruthy();
    if (!candidate) throw new Error("candidate not found");

    const files = Object.entries(stripped)
      .filter(([path]) => path.startsWith("skill/"))
      .map(([path, bytes]) => ({ path, bytes }));
    const selected = computeDefaultSelectedPaths({ candidate, files });
    expect(selected).toContain("skill/SKILL.md");
    expect(selected).toContain("skill/docs/usage.md");
    expect(selected).toContain("skill/docs/more.md");
    expect(selected).toContain("skill/img/logo.svg");
    expect(selected).not.toContain("skill/extra.txt");
  });

  it("does not select files outside skill folder (even when referenced)", () => {
    const entries = {
      "skill/SKILL.md": `See [outside](../outside.md) and [abs](/abs.md) and [mail](mailto:test@example.com).`,
      "outside.md": `secret`,
      "skill/docs/usage.md": `Ok`,
    };
    const zip = buildGitHubZipForTests(
      Object.fromEntries(Object.entries(entries).map(([k, v]) => [`repo-1/${k}`, v])),
    );
    const stripped = stripGitHubZipRoot(unzipSync(zip));
    const candidate = detectGitHubImportCandidates(stripped).find((c) => c.path === "skill");
    expect(candidate).toBeTruthy();
    if (!candidate) throw new Error("candidate not found");
    const files = Object.entries(stripped).map(([path, bytes]) => ({ path, bytes }));
    const selected = computeDefaultSelectedPaths({ candidate, files });
    expect(selected).toContain("skill/SKILL.md");
    expect(selected).not.toContain("outside.md");
  });

  it("extracts markdown targets with titles and angle brackets", () => {
    const targets = extractMarkdownRelativeTargets(
      `See [a](docs/usage.md "Title") and [b](<docs/my file.md>) and ![c](img/logo.svg)`,
    );
    expect(targets).toEqual(["docs/usage.md", "docs/my file.md", "img/logo.svg"]);
  });

  it("resolves markdown targets safely", () => {
    expect(resolveMarkdownTarget("a/SKILL.md", "docs/usage.md")).toBe("a/docs/usage.md");
    expect(resolveMarkdownTarget("a/SKILL.md", "../oops.md")).toBeNull();
    expect(resolveMarkdownTarget("a/SKILL.md", "/abs.md")).toBeNull();
    expect(resolveMarkdownTarget("a/SKILL.md", "docs/usage.md#section")).toBe("a/docs/usage.md");
    expect(resolveMarkdownTarget("a/SKILL.md", "docs/usage.md?x=1")).toBe("a/docs/usage.md");
  });

  it("resolves HEAD commit via redirect chain and refuses unexpected redirect hosts", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = requestInfoToUrlString(input);
      if (url.includes("/archive/HEAD.zip")) {
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://codeload.github.com/a/b/zip/0123456789012345678901234567890123456789",
          },
        });
      }
      if (url.startsWith("https://codeload.github.com/a/b/zip/")) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const resolved = await resolveGitHubCommit(
      { owner: "a", repo: "b", originalUrl: "https://github.com/a/b" },
      fetcher,
    );
    expect(resolved.commit).toBe("0123456789012345678901234567890123456789");

    const badFetcher: typeof fetch = async (input) => {
      const url = requestInfoToUrlString(input);
      if (url.includes("/archive/HEAD.zip")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/zip/abc" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    await expect(
      resolveGitHubCommit(
        { owner: "a", repo: "b", originalUrl: "https://github.com/a/b" },
        badFetcher,
      ),
    ).rejects.toThrow(/redirect/i);
  });

  it("resolves explicit ref commit via GitHub API", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = requestInfoToUrlString(input);
      if (url.startsWith("https://api.github.com/repos/a/b/commits/")) {
        return new Response(JSON.stringify({ sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const resolved = await resolveGitHubCommit(
      { owner: "a", repo: "b", ref: "main", originalUrl: "https://github.com/a/b" },
      fetcher,
    );
    expect(resolved.commit).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("enforces zip byte cap when content-length is too large", async () => {
    const resolved = {
      owner: "a",
      repo: "b",
      ref: "main",
      commit: "0123456789012345678901234567890123456789",
      path: "",
      repoUrl: "https://github.com/a/b",
      originalUrl: "https://github.com/a/b",
    } as const;
    const fetcher: typeof fetch = async () =>
      new Response(new Blob([new Uint8Array([1, 2, 3])]), {
        status: 200,
        headers: { "content-length": String(999_999_999) },
      });
    await expect(fetchGitHubZipBytes(resolved, fetcher, { maxZipBytes: 10 })).rejects.toThrow(
      /too large/i,
    );
  });
});
