import { MAX_SKILL_DISPLAY_NAME_LENGTH } from "clawhub-schema";
import { describe, expect, it } from "vitest";
import {
  buildGitHubSkillSourceSnapshot,
  buildGitHubSkillSyncPlan,
  parseSkillsShDisplayManifest,
} from "./githubSkillSync";

const encoder = new TextEncoder();

function bytes(text: string) {
  return encoder.encode(text);
}

function repoEntries(entries: Record<string, string>) {
  return Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, bytes(text)]));
}

describe("parseSkillsShDisplayManifest", () => {
  it("keeps the supported skills.sh rendering fields and drops invalid groups", () => {
    const result = parseSkillsShDisplayManifest(
      JSON.stringify({
        notGrouped: "top",
        groupings: [
          {
            title: "Agentic AI",
            description: "Agentic workflows.",
            skills: ["aiq-deploy", "nemoclaw-user-configure-security"],
          },
          { title: "Broken", skills: [123] },
          { description: "Missing title", skills: ["ignored"] },
        ],
      }),
    );

    expect(result).toEqual({
      status: "ok",
      manifest: {
        notGrouped: "top",
        groupings: [
          {
            title: "Agentic AI",
            description: "Agentic workflows.",
            skills: ["aiq-deploy", "nemoclaw-user-configure-security"],
          },
        ],
      },
    });
  });

  it("marks missing and invalid manifests so the UI can fall back", () => {
    expect(parseSkillsShDisplayManifest(undefined)).toEqual({
      status: "missing",
      manifest: undefined,
    });
    expect(parseSkillsShDisplayManifest("{nope")).toEqual({
      status: "invalid",
      manifest: undefined,
    });
    expect(parseSkillsShDisplayManifest(JSON.stringify({ groupings: [] }))).toEqual({
      status: "invalid",
      manifest: undefined,
    });
  });
});

describe("buildGitHubSkillSourceSnapshot", () => {
  it("discovers skill folders, parses SKILL.md metadata, and hashes exact folder bytes", async () => {
    const baseEntries = repoEntries({
      "skills/aiq-deploy/SKILL.md":
        "---\nname: AIQ Deploy\nversion: 0.2.0\ndescription: Deploy AgentIQ workflows.\n---\n# AIQ Deploy\n",
      "skills/aiq-deploy/skill-card.md": "# Card\n",
      "skills/vision-helper/SKILL.md": "# Vision Helper\n",
      "skills.sh.json": JSON.stringify({
        groupings: [{ title: "Agentic AI", skills: ["aiq-deploy"] }],
      }),
    });
    const changedEntries = {
      ...baseEntries,
      "skills/aiq-deploy/skill-card.md": bytes("# Card changed\n"),
    };

    const base = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "1".repeat(40),
      entries: baseEntries,
    });
    const changed = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: changedEntries,
    });

    expect(base.manifestStatus).toBe("ok");
    expect(base.manifest).toEqual({
      groupings: [{ title: "Agentic AI", skills: ["aiq-deploy"] }],
    });
    expect(base.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          summary: "Deploy AgentIQ workflows.",
          upstreamVersion: "0.2.0",
          path: "skills/aiq-deploy",
          skillMarkdownPath: "skills/aiq-deploy/SKILL.md",
          skillMarkdown:
            "---\nname: AIQ Deploy\nversion: 0.2.0\ndescription: Deploy AgentIQ workflows.\n---\n# AIQ Deploy\n",
          skillCardMarkdownPath: "skills/aiq-deploy/skill-card.md",
          skillCardMarkdown: "# Card\n",
        }),
        expect.objectContaining({
          slug: "vision-helper",
          displayName: "Vision Helper",
          path: "skills/vision-helper",
          skillMarkdownPath: "skills/vision-helper/SKILL.md",
          skillMarkdown: "# Vision Helper\n",
        }),
      ]),
    );
    expect(changed.skills.find((skill) => skill.slug === "aiq-deploy")?.contentHash).not.toBe(
      base.skills.find((skill) => skill.slug === "aiq-deploy")?.contentHash,
    );
    expect(changed.skills.find((skill) => skill.slug === "vision-helper")?.contentHash).toBe(
      base.skills.find((skill) => skill.slug === "vision-helper")?.contentHash,
    );
  });

  it("includes valid filenames containing dot-dot text in folder hashes", async () => {
    const base = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "1".repeat(40),
      entries: repoEntries({
        "skills/aiq-deploy/SKILL.md": "# AIQ Deploy\n",
        "skills/aiq-deploy/payload..sh": "echo safe\n",
      }),
    });
    const changed = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: repoEntries({
        "skills/aiq-deploy/SKILL.md": "# AIQ Deploy\n",
        "skills/aiq-deploy/payload..sh": "echo changed\n",
      }),
    });

    expect(changed.skills[0]?.contentHash).not.toBe(base.skills[0]?.contentHash);
  });

  it("rejects duplicate normalized skill slugs before syncing content", async () => {
    await expect(
      buildGitHubSkillSourceSnapshot({
        repo: "NVIDIA/skills",
        defaultBranch: "main",
        commit: "1".repeat(40),
        entries: repoEntries({
          "skills/aiq_deploy/SKILL.md": "# AIQ Deploy A\n",
          "skills/aiq-deploy/SKILL.md": "# AIQ Deploy B\n",
        }),
      }),
    ).rejects.toThrow(/duplicate normalized slug/i);
  });

  it("prefers the top-level skills catalog folder over duplicate plugin copies", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "1".repeat(40),
      entries: repoEntries({
        "skills/aiq-deploy/SKILL.md": "# AIQ Deploy\n",
        "plugins/nvidia-skills/skills/aiq-deploy/SKILL.md": "# Plugin Copy\n",
        "skills.sh.json": JSON.stringify({
          groupings: [{ title: "Agentic AI", skills: ["aiq-deploy"] }],
        }),
      }),
    });

    expect(snapshot.skills.map((skill) => skill.path)).toEqual(["skills/aiq-deploy"]);
    expect(snapshot.skills[0]?.displayName).toBe("AIQ Deploy");
  });

  it("caps GitHub-backed display names before they can enter catalog writes", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "1".repeat(40),
      entries: repoEntries({
        "skills/this-slug-is-also-longer-than-forty-characters/SKILL.md":
          "---\nname: This display name is intentionally much longer than forty characters\n---\n# Long\n",
      }),
    });

    expect(snapshot.skills[0]?.displayName).toMatch(/^This Slug Is Also Longer Than Forty/);
    expect(snapshot.skills[0]?.displayName).toHaveLength(MAX_SKILL_DISPLAY_NAME_LENGTH);
  });

  it("rejects oversized cached markdown before writing Convex content docs", async () => {
    await expect(
      buildGitHubSkillSourceSnapshot({
        repo: "NVIDIA/skills",
        defaultBranch: "main",
        commit: "1".repeat(40),
        entries: repoEntries({
          "skills/aiq-deploy/SKILL.md": `# AIQ Deploy\n${"x".repeat(513 * 1024)}`,
        }),
      }),
    ).rejects.toThrow(/too large to cache/i);
  });
});

describe("buildGitHubSkillSyncPlan", () => {
  it("marks changed upstream content pending", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: repoEntries({
        "skills/aiq-deploy/SKILL.md": "# AIQ Deploy v2\n",
        "skills.sh.json": JSON.stringify({
          groupings: [{ title: "Agentic AI", skills: ["aiq-deploy"] }],
        }),
      }),
    });

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:nvidia",
      ownerUserId: "users:nvidia",
      ownerPublisherId: "publishers:nvidia",
      existingSkills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          githubPath: "skills/aiq-deploy",
          githubCurrentStatus: "present",
          githubCurrentContentHash: "old-hash",
          githubScanStatus: "clean",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(plan.skillPatches).toEqual([
      expect.objectContaining({
        skillId: "skills:aiq-deploy",
        slug: "aiq-deploy",
        patch: expect.objectContaining({
          githubCurrentCommit: "2".repeat(40),
          githubCurrentContentHash: snapshot.skills[0]?.contentHash,
          githubScanStatus: "pending",
          moderationStatus: "active",
          moderationReason: "pending.scan",
        }),
      }),
    ]);
    expect(plan.skillInserts).toEqual([]);
    expect(plan.stats.changed).toBe(1);
  });

  it("keeps clean scan status when only the repo commit changes", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: repoEntries({
        "skills/aiq-deploy/SKILL.md": "---\nversion: 0.2.0\n---\n# AIQ Deploy\n",
      }),
    });
    const contentHash = snapshot.skills[0]?.contentHash ?? "";

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:nvidia",
      ownerUserId: "users:nvidia",
      ownerPublisherId: "publishers:nvidia",
      existingSkills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          latestVersionSummary: {
            version: "0.2.0",
            createdAt: 7,
          },
          githubPath: "skills/aiq-deploy",
          githubCurrentStatus: "present",
          githubCurrentContentHash: contentHash,
          githubScanStatus: "clean",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(plan.skillPatches[0]?.patch).toMatchObject({
      githubCurrentCommit: "2".repeat(40),
      githubCurrentContentHash: contentHash,
      githubScanStatus: "clean",
      moderationStatus: "active",
      moderationVerdict: "clean",
    });
    expect(plan.skillPatches[0]?.patch).not.toHaveProperty("updatedAt");
    expect(plan.skillPatches[0]?.patch).not.toHaveProperty("latestVersionSummary");
    expect(plan.stats.unchanged).toBe(1);
  });

  it("preserves existing over-limit GitHub-backed display names during sync", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: repoEntries({
        "skills/this-slug-is-also-longer-than-forty-characters/SKILL.md":
          "---\nname: This display name is intentionally much longer than forty characters\n---\n# Long\n",
      }),
    });
    const contentHash = snapshot.skills[0]?.contentHash ?? "";
    const legacyDisplayName = "This existing GitHub-backed display name is longer than forty characters";

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:nvidia",
      ownerUserId: "users:nvidia",
      ownerPublisherId: "publishers:nvidia",
      existingSkills: [
        {
          _id: "skills:long-name",
          slug: "this-slug-is-also-longer-than-forty-characters",
          displayName: legacyDisplayName,
          githubPath: "skills/this-slug-is-also-longer-than-forty-characters",
          githubCurrentStatus: "present",
          githubCurrentContentHash: contentHash,
          githubScanStatus: "clean",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(snapshot.skills[0]?.displayName).not.toBe(legacyDisplayName);
    expect(plan.skillPatches[0]?.patch).toMatchObject({
      displayName: legacyDisplayName,
      githubCurrentContentHash: contentHash,
      githubScanStatus: "clean",
    });
    expect(plan.skillPatches[0]?.patch).not.toHaveProperty("updatedAt");
    expect(plan.stats.unchanged).toBe(1);
  });

  it("updates existing skill ownership when a source is reassigned", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: repoEntries({
        "skills/aiq-deploy/SKILL.md": "# AIQ Deploy\n",
      }),
    });

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:nvidia",
      ownerUserId: "users:new-owner",
      ownerPublisherId: "publishers:new-owner",
      existingSkills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          githubPath: "skills/aiq-deploy",
          githubCurrentStatus: "present",
          githubCurrentContentHash: snapshot.skills[0]?.contentHash ?? "",
          githubScanStatus: "clean",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(plan.skillPatches[0]?.patch).toMatchObject({
      ownerUserId: "users:new-owner",
      ownerPublisherId: "publishers:new-owner",
    });
  });

  it("preserves pending scan status for unchanged pending content", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "3".repeat(40),
      entries: repoEntries({
        "skills/aiq-deploy/SKILL.md": "# AIQ Deploy\n",
      }),
    });
    const contentHash = snapshot.skills[0]?.contentHash ?? "";

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:nvidia",
      ownerUserId: "users:nvidia",
      ownerPublisherId: "publishers:nvidia",
      existingSkills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          githubPath: "skills/aiq-deploy",
          githubCurrentStatus: "present",
          githubCurrentContentHash: contentHash,
          githubScanStatus: "pending",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(plan.skillPatches[0]?.patch).toMatchObject({
      githubCurrentCommit: "3".repeat(40),
      githubCurrentContentHash: contentHash,
      githubScanStatus: "pending",
      moderationStatus: "active",
      moderationReason: "pending.scan",
    });
    expect(plan.stats.unchanged).toBe(1);
  });

  it("preserves terminal scan status for unchanged current content", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "3".repeat(40),
      entries: repoEntries({
        "skills/aiq-deploy/SKILL.md": "# AIQ Deploy\n",
      }),
    });
    const contentHash = snapshot.skills[0]?.contentHash ?? "";

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:nvidia",
      ownerUserId: "users:nvidia",
      ownerPublisherId: "publishers:nvidia",
      existingSkills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          githubPath: "skills/aiq-deploy",
          githubCurrentStatus: "present",
          githubCurrentContentHash: contentHash,
          githubScanStatus: "malicious",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(plan.skillPatches[0]?.patch).toMatchObject({
      githubCurrentContentHash: contentHash,
      githubScanStatus: "malicious",
      moderationStatus: "hidden",
      moderationReason: "scanner.llm.malicious",
    });
  });

  it("preserves terminal scan status for unchanged current bytes", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "3".repeat(40),
      entries: repoEntries({
        "skills/aiq-deploy/SKILL.md": "# AIQ Deploy\n",
      }),
    });
    const contentHash = snapshot.skills[0]?.contentHash ?? "";

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:nvidia",
      ownerUserId: "users:nvidia",
      ownerPublisherId: "publishers:nvidia",
      existingSkills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          githubPath: "skills/aiq-deploy",
          githubCurrentStatus: "present",
          githubCurrentContentHash: contentHash,
          githubScanStatus: "malicious",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(plan.skillPatches[0]?.patch).toMatchObject({
      githubCurrentContentHash: contentHash,
      githubScanStatus: "malicious",
      moderationStatus: "hidden",
      moderationReason: "scanner.llm.malicious",
    });
    expect(plan.skillPatches[0]?.patch).not.toHaveProperty("updatedAt");
    expect(plan.stats.unchanged).toBe(1);
  });

  it("preserves failed scan status for unchanged current bytes", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "3".repeat(40),
      entries: repoEntries({
        "skills/aiq-deploy/SKILL.md": "# AIQ Deploy\n",
      }),
    });
    const contentHash = snapshot.skills[0]?.contentHash ?? "";

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:nvidia",
      ownerUserId: "users:nvidia",
      ownerPublisherId: "publishers:nvidia",
      existingSkills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          githubPath: "skills/aiq-deploy",
          githubCurrentStatus: "present",
          githubCurrentContentHash: contentHash,
          githubScanStatus: "failed",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(plan.skillPatches[0]?.patch).toMatchObject({
      githubCurrentContentHash: contentHash,
      githubScanStatus: "failed",
      moderationStatus: "hidden",
      moderationReason: "scanner.failed",
    });
    expect(plan.skillPatches[0]?.patch).not.toHaveProperty("updatedAt");
    expect(plan.stats.unchanged).toBe(1);
  });

  it("revives soft-deleted skills when a configured repo is synced again", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "mattpocock/skills",
      defaultBranch: "main",
      commit: "4".repeat(40),
      entries: repoEntries({
        "skills/engineering/tdd/SKILL.md": "# TDD\n",
      }),
    });

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:matt",
      ownerUserId: "users:matt",
      ownerPublisherId: "publishers:matt",
      existingSkills: [
        {
          _id: "skills:tdd",
          slug: "tdd",
          displayName: "TDD",
          githubPath: "skills/engineering/tdd",
          githubCurrentStatus: "missing",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(plan.skillPatches[0]?.patch).toMatchObject({
      githubCurrentStatus: "present",
      githubRemovedAt: undefined,
      softDeletedAt: undefined,
    });
  });

  it("tombstones upstream removals instead of leaving stale installs active", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: repoEntries({
        "skills/vision-helper/SKILL.md": "# Vision Helper\n",
      }),
    });

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:nvidia",
      ownerUserId: "users:nvidia",
      ownerPublisherId: "publishers:nvidia",
      existingSkills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          githubPath: "skills/aiq-deploy",
          githubScanStatus: "clean",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(plan.skillPatches).toEqual([
      expect.objectContaining({
        skillId: "skills:aiq-deploy",
        slug: "aiq-deploy",
        patch: expect.objectContaining({
          githubCurrentCommit: "2".repeat(40),
          githubCurrentStatus: "missing",
          githubRemovedAt: 123,
          softDeletedAt: 123,
          moderationStatus: "hidden",
          moderationReason: "github.upstream.removed",
        }),
      }),
    ]);
    expect(plan.skillInserts).toHaveLength(1);
    expect(plan.stats.removed).toBe(1);
  });

  it("preserves first upstream removal time on later syncs", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "3".repeat(40),
      entries: repoEntries({
        "skills/vision-helper/SKILL.md": "# Vision Helper\n",
      }),
    });

    const plan = buildGitHubSkillSyncPlan({
      sourceId: "githubSkillSources:nvidia",
      ownerUserId: "users:nvidia",
      ownerPublisherId: "publishers:nvidia",
      existingSkills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          githubPath: "skills/aiq-deploy",
          githubCurrentStatus: "missing",
          githubRemovedAt: 77,
          githubScanStatus: "clean",
        },
      ],
      snapshot,
      now: 123,
    });

    expect(plan.skillPatches[0]?.patch).toMatchObject({
      githubCurrentCommit: "3".repeat(40),
      githubCurrentStatus: "missing",
      githubCurrentCheckedAt: 123,
      githubRemovedAt: 77,
      moderationStatus: "hidden",
      moderationReason: "github.upstream.removed",
    });
    expect(plan.skillPatches[0]?.patch).not.toHaveProperty("updatedAt");
  });
});
