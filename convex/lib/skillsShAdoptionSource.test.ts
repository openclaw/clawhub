/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { computeGitHubSkillFolderContentHash } from "./githubSkillSync";
import { fetchExactSkillsShAdoptionSource } from "./skillsShAdoptionSource";

const COMMIT = "a".repeat(40);

function encoded(value: string) {
  return btoa(value);
}

function githubFetchFixture(options: {
  requestedRepository: string;
  canonicalRepository: string;
  tree: Array<{ path: string; sha: string; size?: number }>;
  blobs: Record<string, string>;
  blobContentLengths?: Record<string, number>;
  commitContentLength?: number;
  treeContentLength?: number;
}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === `https://api.github.com/repos/${options.requestedRepository}`) {
      const [owner] = options.canonicalRepository.split("/");
      return Response.json({
        id: 123,
        full_name: options.canonicalRepository,
        owner: { login: owner, id: 42 },
        private: false,
        visibility: "public",
      });
    }
    if (
      url === `https://api.github.com/repos/${options.canonicalRepository}/git/commits/${COMMIT}`
    ) {
      return Response.json(
        { sha: COMMIT, tree: { sha: "tree-sha" } },
        options.commitContentLength
          ? { headers: { "content-length": String(options.commitContentLength) } }
          : undefined,
      );
    }
    if (
      url ===
      `https://api.github.com/repos/${options.canonicalRepository}/git/trees/tree-sha?recursive=1`
    ) {
      return Response.json(
        {
          truncated: false,
          tree: options.tree.map((entry) => ({
            ...entry,
            type: "blob",
            size: entry.size ?? options.blobs[entry.sha]?.length ?? 0,
          })),
        },
        options.treeContentLength
          ? { headers: { "content-length": String(options.treeContentLength) } }
          : undefined,
      );
    }
    const blobPrefix = `https://api.github.com/repos/${options.canonicalRepository}/git/blobs/`;
    if (url.startsWith(blobPrefix)) {
      const sha = url.slice(blobPrefix.length);
      const content = options.blobs[sha];
      if (content === undefined) return new Response("Not Found", { status: 404 });
      return Response.json(
        { encoding: "base64", content: encoded(content) },
        options.blobContentLengths?.[sha]
          ? { headers: { "content-length": String(options.blobContentLengths[sha]) } }
          : undefined,
      );
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  }) as typeof fetch;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fetchExactSkillsShAdoptionSource", () => {
  it("follows a canonical repository redirect and returns only the exact folder", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    const entries = {
      "skills/demo/SKILL.md": new TextEncoder().encode("# Demo"),
      "skills/demo/tool.ts": new TextEncoder().encode("export {};"),
      "skills/other/SKILL.md": new TextEncoder().encode("# Other"),
    };
    const sourceContentHash = await computeGitHubSkillFolderContentHash(entries, "skills/demo");
    const fetchImpl = githubFetchFixture({
      requestedRepository: "legacy/skills",
      canonicalRepository: "openclaw/skills",
      tree: [
        { path: "skills/demo/SKILL.md", sha: "skill" },
        { path: "skills/demo/tool.ts", sha: "tool" },
        { path: "skills/other/SKILL.md", sha: "other" },
      ],
      blobs: {
        skill: "# Demo",
        tool: "export {};",
        other: "# Other",
      },
    });

    const result = await fetchExactSkillsShAdoptionSource(
      {
        externalId: "legacy/skills/demo",
        owner: "legacy",
        repo: "skills",
        githubPath: "skills/demo",
        githubCommit: COMMIT,
        sourceContentHash,
      },
      fetchImpl,
    );

    expect(result).toMatchObject({
      externalId: "legacy/skills/demo",
      repository: "openclaw/skills",
      repositoryOwnerId: 42,
      githubPath: "skills/demo",
      githubCommit: COMMIT,
      sourceContentHash,
      files: [{ path: "SKILL.md" }, { path: "tool.ts" }],
    });
    expect(fetchImpl).not.toHaveBeenCalledWith(
      "https://api.github.com/repos/openclaw/skills/git/blobs/other",
      expect.anything(),
    );
  });

  it("treats dot as repository root and includes the complete recursive tree", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    const entries = {
      "SKILL.md": new TextEncoder().encode("# Root"),
      "nested/ignored.ts": new TextEncoder().encode("ignored"),
    };
    const sourceContentHash = await computeGitHubSkillFolderContentHash(entries, "");
    const fetchImpl = githubFetchFixture({
      requestedRepository: "acme/root-skill",
      canonicalRepository: "acme/root-skill",
      tree: [
        { path: "SKILL.md", sha: "skill" },
        { path: "nested/ignored.ts", sha: "ignored" },
      ],
      blobs: {
        skill: "# Root",
        ignored: "ignored",
      },
    });

    const result = await fetchExactSkillsShAdoptionSource(
      {
        externalId: "acme/root-skill/root-skill",
        owner: "acme",
        repo: "root-skill",
        githubPath: ".",
        githubCommit: COMMIT,
        sourceContentHash,
      },
      fetchImpl,
    );

    expect(result.githubPath).toBe(".");
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "SKILL.md",
          bytes: new TextEncoder().encode("# Root"),
        }),
        expect.objectContaining({
          path: "nested/ignored.ts",
          bytes: new TextEncoder().encode("ignored"),
        }),
      ]),
    );
    expect(result.files).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/root-skill/git/blobs/ignored",
      expect.anything(),
    );
  });

  it("rejects an oversized declared blob before downloading it", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    const fetchImpl = githubFetchFixture({
      requestedRepository: "acme/skills",
      canonicalRepository: "acme/skills",
      tree: [{ path: "skills/demo/SKILL.md", sha: "skill", size: 10 * 1024 * 1024 + 1 }],
      blobs: { skill: "# Demo" },
    });

    await expect(
      fetchExactSkillsShAdoptionSource(
        {
          externalId: "acme/skills/demo",
          owner: "acme",
          repo: "skills",
          githubPath: "skills/demo",
          githubCommit: COMMIT,
          sourceContentHash: "b".repeat(64),
        },
        fetchImpl,
      ),
    ).rejects.toThrow("Mirrored skills.sh file is too large");
    expect(fetchImpl).not.toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/skills/git/blobs/skill",
      expect.anything(),
    );
  });

  it("bounds blob responses even when the tree reports a small file", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    const fetchImpl = githubFetchFixture({
      requestedRepository: "acme/skills",
      canonicalRepository: "acme/skills",
      tree: [{ path: "skills/demo/SKILL.md", sha: "skill", size: 6 }],
      blobs: { skill: "# Demo" },
      blobContentLengths: { skill: Number.MAX_SAFE_INTEGER },
    });

    await expect(
      fetchExactSkillsShAdoptionSource(
        {
          externalId: "acme/skills/demo",
          owner: "acme",
          repo: "skills",
          githubPath: "skills/demo",
          githubCommit: COMMIT,
          sourceContentHash: "b".repeat(64),
        },
        fetchImpl,
      ),
    ).rejects.toThrow("GitHub source response is too large");
  });

  it.each([
    ["commit", { commitContentLength: Number.MAX_SAFE_INTEGER }],
    ["tree", { treeContentLength: Number.MAX_SAFE_INTEGER }],
  ])("bounds oversized %s metadata responses", async (_name, responseLengths) => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    const fetchImpl = githubFetchFixture({
      requestedRepository: "acme/skills",
      canonicalRepository: "acme/skills",
      tree: [{ path: "skills/demo/SKILL.md", sha: "skill", size: 6 }],
      blobs: { skill: "# Demo" },
      ...responseLengths,
    });

    await expect(
      fetchExactSkillsShAdoptionSource(
        {
          externalId: "acme/skills/demo",
          owner: "acme",
          repo: "skills",
          githubPath: "skills/demo",
          githubCommit: COMMIT,
          sourceContentHash: "b".repeat(64),
        },
        fetchImpl,
      ),
    ).rejects.toThrow("GitHub source response is too large");
  });
});
