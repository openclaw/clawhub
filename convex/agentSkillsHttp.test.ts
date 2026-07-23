/* @vitest-environment node */

import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { stripGitHubZipRoot } from "./lib/githubImport";
import { computeGitHubSkillFolderContentHash } from "./lib/githubSkillSync";
import { buildDeterministicZip } from "./lib/skillZip";

vi.mock("./lib/githubImport", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/githubImport")>();
  return {
    ...original,
    fetchGitHubZipBytes: vi.fn(),
  };
});

const { agentSkillsHttpHandler } = await import("./agentSkillsHttp");
const { fetchGitHubZipBytes } = await import("./lib/githubImport");

const baseSkill = {
  _id: "skills:demo",
  slug: "demo",
  displayName: "Demo",
  latestVersionId: "skillVersions:demo",
  latestVersionSummary: { version: "1.0.0" },
};

function makeCtx(partial: Record<string, unknown>) {
  return partial as unknown as ActionCtx;
}

function hostedRunQuery({
  publicSkill = true,
  moderationInfo,
  llmAnalysis,
}: {
  publicSkill?: boolean;
  moderationInfo?: {
    isPendingScan?: boolean;
    isMalwareBlocked?: boolean;
    isHiddenByMod?: boolean;
    isRemoved?: boolean;
    sourceVersionId?: string;
  };
  llmAnalysis?: {
    status?: string;
    verdict?: string;
  };
} = {}) {
  return vi
    .fn()
    .mockResolvedValueOnce(baseSkill)
    .mockResolvedValueOnce(
      publicSkill
        ? {
            skill: {
              _id: "skills:demo",
              displayName: "Demo",
              summary: "A demo skill.",
            },
            latestVersion: {
              version: "1.0.0",
              files: [
                { path: "SKILL.md", size: 25, sha256: "skill-hash" },
                { path: "references/proof.txt", size: 5, sha256: "proof-hash" },
              ],
            },
            moderationInfo,
          }
        : null,
    )
    .mockResolvedValueOnce({
      _id: "skillVersions:demo",
      skillId: "skills:demo",
      version: "1.0.0",
      files: [
        { path: "SKILL.md", storageId: "_storage:skill" },
        { path: "references/proof.txt", storageId: "_storage:proof" },
      ],
      llmAnalysis,
    });
}

describe("Agent Skills discovery HTTP handler", () => {
  afterEach(() => {
    vi.mocked(fetchGitHubZipBytes).mockReset();
  });

  it("returns a discovery document for a public hosted skill", async () => {
    const response = await agentSkillsHttpHandler(
      makeCtx({
        runQuery: hostedRunQuery(),
        storage: {
          get: vi
            .fn()
            .mockResolvedValueOnce(new Blob(["---\nname: demo\n---\n"]))
            .mockResolvedValueOnce(new Blob(["proof"])),
        },
      }),
      new Request("https://api.example/api/v1/agent-skills/openclaw/demo/index.json"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("max-age=60");
    expect(await response.json()).toEqual({
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: [
        {
          name: "demo",
          type: "archive",
          description: "A demo skill.",
          url: "https://api.example/api/v1/agent-skills/openclaw/demo/archive?version=1.0.0",
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      ],
    });
  });

  it("serves a normalized hosted archive only for the pinned version", async () => {
    const storageGet = vi
      .fn()
      .mockResolvedValueOnce(new Blob(["---\nname: demo\n---\n"]))
      .mockResolvedValueOnce(new Blob(["proof"]));
    const response = await agentSkillsHttpHandler(
      makeCtx({
        runQuery: hostedRunQuery(),
        storage: { get: storageGet },
      }),
      new Request("https://api.example/api/v1/agent-skills/openclaw/demo/archive?version=1.0.0"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(Object.keys(unzipSync(new Uint8Array(await response.arrayBuffer()))).sort()).toEqual([
      "SKILL.md",
      "references/proof.txt",
    ]);

    const staleResponse = await agentSkillsHttpHandler(
      makeCtx({
        runQuery: hostedRunQuery(),
        storage: { get: vi.fn() },
      }),
      new Request("https://api.example/api/v1/agent-skills/openclaw/demo/archive?version=0.9.0"),
    );
    expect(staleResponse.status).toBe(404);
    expect(await staleResponse.text()).toBe("Skill version not available");
  });

  it("serves a cached hosted archive after a newer version becomes current", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        ...baseSkill,
        latestVersionId: "skillVersions:current",
        latestVersionSummary: { version: "2.0.0" },
      })
      .mockResolvedValueOnce({
        skill: {
          _id: "skills:demo",
          displayName: "Demo",
          summary: "A demo skill.",
        },
        latestVersion: { version: "2.0.0" },
      })
      .mockResolvedValueOnce({
        _id: "skillVersions:historical",
        skillId: "skills:demo",
        version: "1.0.0",
        files: [{ path: "SKILL.md", storageId: "_storage:historical" }],
      });
    const response = await agentSkillsHttpHandler(
      makeCtx({
        runQuery,
        storage: {
          get: vi.fn().mockResolvedValue(new Blob(["---\nname: demo\n---\n"])),
        },
      }),
      new Request("https://api.example/api/v1/agent-skills/openclaw/demo/archive?version=1.0.0"),
    );

    expect(response.status).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(await response.arrayBuffer())))).toEqual([
      "SKILL.md",
    ]);
  });

  it("does not count archive HEAD probes as downloads", async () => {
    const runAfter = vi.fn();
    const response = await agentSkillsHttpHandler(
      makeCtx({
        runQuery: hostedRunQuery(),
        auth: { getUserIdentity: vi.fn().mockResolvedValue(null) },
        scheduler: { runAfter },
        storage: {
          get: vi
            .fn()
            .mockResolvedValueOnce(new Blob(["---\nname: demo\n---\n"]))
            .mockResolvedValueOnce(new Blob(["proof"])),
        },
      }),
      new Request("https://api.example/api/v1/agent-skills/openclaw/demo/archive?version=1.0.0", {
        method: "HEAD",
        headers: { "x-forwarded-for": "203.0.113.10" },
      }),
    );

    expect(response.status).toBe(200);
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("fails instead of caching an incomplete hosted archive", async () => {
    const response = await agentSkillsHttpHandler(
      makeCtx({
        runQuery: hostedRunQuery(),
        storage: {
          get: vi
            .fn()
            .mockResolvedValueOnce(new Blob(["---\nname: demo\n---\n"]))
            .mockResolvedValueOnce(null),
        },
      }),
      new Request("https://api.example/api/v1/agent-skills/openclaw/demo/archive?version=1.0.0"),
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBeNull();
    expect(await response.text()).toBe("Skill archive file missing from storage");
  });

  it("returns not found for malformed percent escapes", async () => {
    const runQuery = vi.fn();
    const response = await agentSkillsHttpHandler(
      makeCtx({ runQuery, storage: { get: vi.fn() } }),
      new Request("https://api.example/api/v1/agent-skills/openclaw/%ZZ/index.json"),
    );

    expect(response.status).toBe(404);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("does not expose a skill that is unavailable through the public query", async () => {
    const response = await agentSkillsHttpHandler(
      makeCtx({
        runQuery: hostedRunQuery({ publicSkill: false }),
        storage: { get: vi.fn() },
      }),
      new Request("https://api.example/api/v1/agent-skills/openclaw/demo/index.json"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Skill not found");
  });

  it("does not expose a hosted version blocked by moderation or security scanning", async () => {
    const pendingResponse = await agentSkillsHttpHandler(
      makeCtx({
        runQuery: hostedRunQuery({
          moderationInfo: {
            isPendingScan: true,
            sourceVersionId: "skillVersions:demo",
          },
        }),
        storage: { get: vi.fn() },
      }),
      new Request("https://api.example/api/v1/agent-skills/openclaw/demo/index.json"),
    );

    expect(pendingResponse.status).toBe(423);
    expect(await pendingResponse.text()).toContain("pending a ClawScan security review");

    const maliciousResponse = await agentSkillsHttpHandler(
      makeCtx({
        runQuery: hostedRunQuery({
          llmAnalysis: { verdict: "malicious" },
        }),
        storage: { get: vi.fn() },
      }),
      new Request("https://api.example/api/v1/agent-skills/openclaw/demo/index.json"),
    );

    expect(maliciousResponse.status).toBe(403);
    expect(await maliciousResponse.text()).toContain("flagged as malicious");
  });

  it("normalizes a pinned GitHub-backed skill subtree", async () => {
    const sourceArchive = buildDeterministicZip([
      {
        path: "repo-abc123/skills/demo/SKILL.md",
        bytes: new TextEncoder().encode("---\nname: demo\n---\n"),
      },
      {
        path: "repo-abc123/skills/demo/references/proof.txt",
        bytes: new TextEncoder().encode("proof"),
      },
      {
        path: "repo-abc123/README.md",
        bytes: new TextEncoder().encode("outside the skill"),
      },
    ]);
    const archiveEntries = stripGitHubZipRoot(unzipSync(sourceArchive));
    const contentHash = await computeGitHubSkillFolderContentHash(archiveEntries, "skills/demo");
    vi.mocked(fetchGitHubZipBytes).mockResolvedValue(sourceArchive);
    const githubSkill = {
      ...baseSkill,
      installKind: "github",
      githubSourceId: "githubSkillSources:demo",
      githubPath: "skills/demo",
      githubCurrentCommit: "def456",
      githubCurrentContentHash: "current-content",
      githubCurrentStatus: "present",
      githubScanStatus: "clean",
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(githubSkill)
      .mockResolvedValueOnce({
        skill: {
          _id: "skills:demo",
          displayName: "Demo",
          summary: "A GitHub-backed demo skill.",
        },
        latestVersion: null,
      })
      .mockResolvedValueOnce({
        githubSourceId: "githubSkillSources:demo",
        contentHash,
        commit: "def456",
        path: "skills/demo",
        status: "clean",
      })
      .mockResolvedValueOnce({ repo: "openclaw/openclaw", defaultBranch: "main" });

    const response = await agentSkillsHttpHandler(
      makeCtx({ runQuery, storage: { get: vi.fn() } }),
      new Request(
        `https://api.example/api/v1/agent-skills/openclaw/demo/archive?commit=abc123&contentHash=${contentHash}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(await response.arrayBuffer()))).sort()).toEqual([
      "SKILL.md",
      "references/proof.txt",
    ]);
    expect(fetchGitHubZipBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "openclaw",
        repo: "openclaw",
        commit: "abc123",
        path: "skills/demo",
      }),
      fetch,
    );
  });
});
