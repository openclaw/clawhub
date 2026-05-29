/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { __test } from "./githubImport";
import { buildGitHubZipForTests } from "./lib/githubImport";

vi.mock("./_generated/api", () => ({
  internal: {
    githubIdentity: {
      getGitHubProviderAccountIdInternal: Symbol("getGitHubProviderAccountIdInternal"),
    },
    skills: {
      getSkillBySlugInternal: Symbol("getSkillBySlugInternal"),
    },
  },
}));

describe("githubImport", () => {
  it("formats storage failure message with file context", () => {
    const message = __test.buildStoreFailureMessage("skill/SKILL.md", 123, new Error("disk full"));
    expect(message).toBe('Failed to store file "skill/SKILL.md" (123 bytes). disk full');
  });

  it("formats publish failure message with fallback text", () => {
    expect(__test.buildPublishFailureMessage(new Error("slug exists"))).toBe(
      "Import failed during publish: slug exists. Check skill format, slug availability, and try again.",
    );
    expect(
      __test.buildPublishFailureMessage(
        new Error(
          'Uncaught ConvexError: Publisher handle "@local-owner" is already claimed at ensurePersonalPublisherForUser (../../convex/lib/publishers.ts:235:4)',
        ),
      ),
    ).toBe(
      'Import failed during publish: Publisher handle "@local-owner" is already claimed. Check skill format, slug availability, and try again.',
    );
    expect(__test.buildPublishFailureMessage("unexpected")).toBe(
      "Import failed during publish: unexpected. Check skill format, slug availability, and try again.",
    );
  });

  it("filters mac junk files while unzipping archive entries", () => {
    const zip = buildGitHubZipForTests({
      "demo-repo/skill/SKILL.md": "# Demo",
      "demo-repo/skill/notes.md": "notes",
      "demo-repo/skill/.DS_Store": "junk",
      "demo-repo/skill/._notes.md": "junk",
      "demo-repo/__MACOSX/._SKILL.md": "junk",
    });

    const entries = __test.unzipToEntries(zip);
    expect(Object.keys(entries).sort()).toEqual([
      "demo-repo/skill/SKILL.md",
      "demo-repo/skill/notes.md",
    ]);
  });

  it("rejects a public repo owned by another GitHub account before repo lookup", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue("123"),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 123,
        login: "vyctorbrzezowski",
        avatar_url: "https://avatars.githubusercontent.com/u/123?v=4",
      }),
    });

    await expect(
      __test.requireOwnedPublicGitHubRepoForImport(
        ctx as never,
        "users:1" as never,
        "someone-else",
        "public-skill",
        fetchMock as never,
      ),
    ).rejects.toThrow(/owned by your GitHub account/i);

    expect(ctx.runQuery).toHaveBeenCalledWith(
      internal.githubIdentity.getGitHubProviderAccountIdInternal,
      { userId: "users:1" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/user/123",
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": "clawhub/github-import" }),
      }),
    );
  });

  it("rejects a public repo when GitHub metadata owner id does not match the signed-in user", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue("123"),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 123,
          login: "vyctorbrzezowski",
          avatar_url: "https://avatars.githubusercontent.com/u/123?v=4",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: "public-skill",
          full_name: "vyctorbrzezowski/public-skill",
          private: false,
          visibility: "public",
          owner: { id: 456, login: "vyctorbrzezowski" },
        }),
      });

    await expect(
      __test.requireOwnedPublicGitHubRepoForImport(
        ctx as never,
        "users:1" as never,
        "vyctorbrzezowski",
        "public-skill",
        fetchMock as never,
      ),
    ).rejects.toThrow(/owned by your GitHub account/i);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/vyctorbrzezowski/public-skill",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("lists only owned public SKILL.md candidates", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue("123"),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 123,
          login: "vyctorbrzezowski",
          avatar_url: "https://avatars.githubusercontent.com/u/123?v=4",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: "clawhub",
            full_name: "vyctorbrzezowski/clawhub",
            html_url: "https://github.com/vyctorbrzezowski/clawhub",
            default_branch: "main",
            pushed_at: "2026-05-27T00:00:00Z",
            updated_at: "2026-05-27T00:00:00Z",
            language: "TypeScript",
            fork: false,
            archived: false,
            disabled: false,
            private: false,
            visibility: "public",
            owner: { id: 123, login: "vyctorbrzezowski" },
          },
          {
            name: "docs",
            full_name: "vyctorbrzezowski/docs",
            html_url: "https://github.com/vyctorbrzezowski/docs",
            default_branch: "main",
            pushed_at: "2026-05-26T00:00:00Z",
            updated_at: "2026-05-26T00:00:00Z",
            fork: false,
            archived: false,
            disabled: false,
            private: false,
            visibility: "public",
            owner: { id: 123, login: "vyctorbrzezowski" },
          },
          {
            name: "forked-skill",
            full_name: "vyctorbrzezowski/forked-skill",
            default_branch: "main",
            fork: true,
            archived: false,
            disabled: false,
            private: false,
            visibility: "public",
            owner: { id: 123, login: "vyctorbrzezowski" },
          },
          {
            name: "archived-skill",
            full_name: "vyctorbrzezowski/archived-skill",
            default_branch: "main",
            fork: false,
            archived: true,
            disabled: false,
            private: false,
            visibility: "public",
            owner: { id: 123, login: "vyctorbrzezowski" },
          },
          {
            name: "private-skill",
            private: true,
            visibility: "private",
            owner: { id: 123, login: "vyctorbrzezowski" },
          },
          {
            name: "org-skill",
            private: false,
            visibility: "public",
            owner: { id: 456, login: "openclaw" },
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          truncated: false,
          tree: [
            { path: "SKILL.md", type: "blob" },
            { path: "skills/copilot/SKILL.md", type: "blob" },
            { path: ".agents/skills/internal/SKILL.md", type: "blob" },
            { path: "README.md", type: "blob" },
            { path: "skill.md", type: "tree" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          truncated: false,
          tree: [
            { path: "README.md", type: "blob" },
            { path: "guides/usage.md", type: "blob" },
          ],
        }),
      });

    const result = await __test.listOwnedPublicGitHubReposForUser(
      ctx as never,
      "users:1" as never,
      { page: 1, perPage: 30 },
      fetchMock as never,
    );

    expect(result.account.login).toBe("vyctorbrzezowski");
    expect(result.account.avatarUrl).toBe("https://avatars.githubusercontent.com/u/123?v=4");
    expect(result.repos).toEqual([
      expect.objectContaining({
        owner: "vyctorbrzezowski",
        name: "clawhub",
        repoName: "clawhub",
        repoFullName: "vyctorbrzezowski/clawhub",
        fullName: "vyctorbrzezowski/clawhub",
        htmlUrl: "https://github.com/vyctorbrzezowski/clawhub",
        candidatePath: "",
        skillPath: "SKILL.md",
        importable: true,
      }),
      expect.objectContaining({
        owner: "vyctorbrzezowski",
        name: "copilot",
        repoName: "clawhub",
        repoFullName: "vyctorbrzezowski/clawhub",
        fullName: "vyctorbrzezowski/clawhub/skills/copilot",
        htmlUrl: "https://github.com/vyctorbrzezowski/clawhub/tree/main/skills/copilot",
        candidatePath: "skills/copilot",
        skillPath: "skills/copilot/SKILL.md",
        importable: true,
      }),
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/users/vyctorbrzezowski/repos?type=owner&sort=pushed&direction=desc&per_page=30&page=1",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/vyctorbrzezowski/clawhub/git/trees/main?recursive=1",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://api.github.com/repos/vyctorbrzezowski/docs/git/trees/main?recursive=1",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });
});
