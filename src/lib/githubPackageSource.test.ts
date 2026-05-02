import { describe, expect, it, vi } from "vitest";
import { fetchGitHubPackageSource } from "./githubPackageSource";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const BLOB = "c".repeat(40);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, contentType = "text/plain") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("fetchGitHubPackageSource", () => {
  it("resolves a repo URL, downloads package files, and reports source metadata", async () => {
    const progress: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.github.com/repos/owner/repo") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url === "https://api.github.com/repos/owner/repo/commits/main") {
        return jsonResponse({ sha: COMMIT, commit: { tree: { sha: TREE } } });
      }
      if (url === `https://api.github.com/repos/owner/repo/git/trees/${TREE}?recursive=1`) {
        return jsonResponse({
          tree: [
            { path: "package.json", type: "blob", sha: BLOB, size: 37 },
            { path: "src/index.ts", type: "blob", sha: BLOB, size: 17 },
          ],
        });
      }
      if (url === `https://raw.githubusercontent.com/owner/repo/${COMMIT}/package.json`) {
        return textResponse('{"name":"demo","version":"1.0.0"}', "application/json");
      }
      if (url === `https://raw.githubusercontent.com/owner/repo/${COMMIT}/src/index.ts`) {
        return textResponse("export const x=1;\n");
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const result = await fetchGitHubPackageSource("https://github.com/owner/repo", {
      fetcher,
      onProgress: (entry) => progress.push(entry.phase),
    });

    expect(result.source).toEqual({
      repo: "owner/repo",
      url: "https://github.com/owner/repo",
      ref: "main",
      commit: COMMIT,
      path: ".",
    });
    expect(result.files.map((file) => file.name)).toEqual(["package.json", "src/index.ts"]);
    expect(await result.files[0]?.text()).toBe('{"name":"demo","version":"1.0.0"}');
    expect(progress).toContain("resolving");
    expect(progress).toContain("listing");
    expect(progress.filter((phase) => phase === "downloading")).toHaveLength(2);
  });

  it("handles branch names with slashes and trims tree URL paths", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.github.com/repos/owner/repo/commits/feature%2Fnew-ui") {
        return jsonResponse({ sha: COMMIT, commit: { tree: { sha: TREE } } });
      }
      if (url === `https://api.github.com/repos/owner/repo/git/trees/${TREE}?recursive=1`) {
        return jsonResponse({
          tree: [
            { path: "plugins/demo/package.json", type: "blob", sha: BLOB, size: 15 },
            { path: "plugins/demo/openclaw.plugin.json", type: "blob", sha: BLOB, size: 11 },
            { path: "other/package.json", type: "blob", sha: BLOB, size: 2 },
          ],
        });
      }
      if (
        url === `https://raw.githubusercontent.com/owner/repo/${COMMIT}/plugins/demo/package.json`
      ) {
        return textResponse('{"name":"demo"}', "application/json");
      }
      if (
        url ===
        `https://raw.githubusercontent.com/owner/repo/${COMMIT}/plugins/demo/openclaw.plugin.json`
      ) {
        return textResponse('{"id":"demo"}', "application/json");
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const result = await fetchGitHubPackageSource(
      "https://github.com/owner/repo/tree/feature/new-ui/plugins/demo",
      { fetcher },
    );

    expect(result.source.ref).toBe("feature/new-ui");
    expect(result.source.path).toBe("plugins/demo");
    expect(result.files.map((file) => file.name)).toEqual(["openclaw.plugin.json", "package.json"]);
  });

  it("rejects oversized GitHub packages before downloading files", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.github.com/repos/owner/repo") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url === "https://api.github.com/repos/owner/repo/commits/main") {
        return jsonResponse({ sha: COMMIT, commit: { tree: { sha: TREE } } });
      }
      if (url === `https://api.github.com/repos/owner/repo/git/trees/${TREE}?recursive=1`) {
        return jsonResponse({
          tree: [{ path: "package.json", type: "blob", sha: BLOB, size: 11 * 1024 * 1024 }],
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    await expect(
      fetchGitHubPackageSource("https://github.com/owner/repo", { fetcher }),
    ).rejects.toThrow(/10MB/);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
