import { describe, expect, it, vi } from "vitest";
import { MAX_PUBLISH_FILE_BYTES } from "./publishLimits";
import { publishVersionForUser, __test } from "./skillPublish";

vi.mock("./embeddings", () => ({
  generateEmbedding: vi.fn(async () => [0, 1, 2]),
}));

describe("skillPublish", () => {
  it("ignores taxonomy declarations from metadata.openclaw.json", async () => {
    const storedFiles = new Map([
      [
        "_storage:skill",
        `---
description: Automation workflow for recurring reports.
---
# Automation Helper
`,
      ],
      [
        "_storage:metadata",
        JSON.stringify({
          categories: ["security"],
          topics: ["Manifest Topic"],
        }),
      ],
    ]);
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("version" in args && "embedding" in args) {
        return {
          skillId: "skills:demo",
          versionId: "skillVersions:demo",
          embeddingId: "skillEmbeddings:demo",
        };
      }
      return null;
    });
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: "users:1", handle: "demo", createdAt: 1 }),
      runMutation,
      scheduler: { runAfter: vi.fn() },
      storage: {
        get: vi.fn(async (storageId: string) => {
          const content = storedFiles.get(storageId);
          return content === undefined ? null : new Blob([content]);
        }),
      },
    };

    await publishVersionForUser(
      ctx as never,
      "users:1" as never,
      {
        slug: "automation-helper",
        displayName: "Automation Helper",
        version: "1.0.0",
        changelog: "Initial release",
        files: [
          {
            path: "SKILL.md",
            size: 90,
            storageId: "_storage:skill" as never,
            sha256: "a".repeat(64),
            contentType: "text/markdown",
          },
          {
            path: "metadata.openclaw.json",
            size: 70,
            storageId: "_storage:metadata" as never,
            sha256: "b".repeat(64),
            contentType: "application/json",
          },
        ],
      },
      {
        bypassGitHubAccountAge: true,
        bypassQualityGate: true,
        skipWebhook: true,
      },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categories: ["other"],
        topics: undefined,
      }),
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      versionId: "skillVersions:demo",
      source: "publish",
    });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(2_000, expect.anything(), {
      versionId: "skillVersions:demo",
      source: "publish",
      preserveActiveJob: true,
      preserveExistingJob: true,
    });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(15_000, expect.anything(), {
      versionId: "skillVersions:demo",
      source: "publish",
      preserveActiveJob: true,
      preserveExistingJob: true,
    });
  });

  it("resolves the target publisher handle before scheduling publish webhooks", async () => {
    const previousWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
    process.env.DISCORD_WEBHOOK_URL = "https://example.invalid/webhook";
    const storedFiles = new Map([
      [
        "_storage:skill",
        `---
description: Org helper.
---
# Org Helper
`,
      ],
    ]);
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("version" in args && "embedding" in args) {
        return {
          skillId: "skills:demo",
          versionId: "skillVersions:demo",
          embeddingId: "skillEmbeddings:demo",
        };
      }
      return null;
    });
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: "users:1", handle: "actor", createdAt: 1 })
        .mockResolvedValueOnce({ _id: "publishers:org", handle: "org-demo" })
        .mockResolvedValueOnce({
          skill: {
            _id: "skills:demo",
            slug: "org-helper",
            displayName: "Org Helper",
            summary: "Org helper",
            tags: {},
          },
          owner: { handle: "org-demo" },
        }),
      runMutation,
      scheduler: { runAfter: vi.fn() },
      storage: {
        get: vi.fn(async (storageId: string) => {
          const content = storedFiles.get(storageId);
          return content === undefined ? null : new Blob([content]);
        }),
      },
    };

    try {
      await publishVersionForUser(
        ctx as never,
        "users:1" as never,
        {
          slug: "org-helper",
          displayName: "Org Helper",
          version: "1.0.0",
          changelog: "Initial release",
          files: [
            {
              path: "SKILL.md",
              size: 70,
              storageId: "_storage:skill" as never,
              sha256: "a".repeat(64),
              contentType: "text/markdown",
            },
          ],
        },
        {
          bypassGitHubAccountAge: true,
          bypassQualityGate: true,
          ownerPublisherId: "publishers:org" as never,
        },
      );

      await vi.waitFor(() => {
        expect(ctx.runQuery).toHaveBeenCalledWith(expect.anything(), {
          slug: "org-helper",
          ownerHandle: "org-demo",
        });
      });
    } finally {
      if (previousWebhookUrl === undefined) {
        delete process.env.DISCORD_WEBHOOK_URL;
      } else {
        process.env.DISCORD_WEBHOOK_URL = previousWebhookUrl;
      }
    }
  });

  it("uses Other when an existing skill has a retired stored category", async () => {
    const storedFiles = new Map([
      [
        "_storage:skill",
        `---
description: Research helper for literature reviews.
---
# Research Helper
`,
      ],
    ]);
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("version" in args && "embedding" in args) {
        return {
          skillId: "skills:demo",
          versionId: "skillVersions:demo",
          embeddingId: "skillEmbeddings:demo",
        };
      }
      return null;
    });
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "skills:demo",
          slug: "research-helper",
          displayName: "Research Helper",
          summary: "Research helper",
          ownerUserId: "users:1",
          latestVersionSummary: { version: "0.9.0" },
          categories: ["retired-category"],
        })
        .mockResolvedValueOnce({ _id: "users:1", handle: "demo", createdAt: 1 }),
      runMutation,
      scheduler: { runAfter: vi.fn() },
      storage: {
        get: vi.fn(async (storageId: string) => {
          const content = storedFiles.get(storageId);
          return content === undefined ? null : new Blob([content]);
        }),
      },
    };

    await publishVersionForUser(
      ctx as never,
      "users:1" as never,
      {
        slug: "research-helper",
        displayName: "Research Helper",
        version: "1.0.0",
        changelog: "Update",
        files: [
          {
            path: "SKILL.md",
            size: 90,
            storageId: "_storage:skill" as never,
            sha256: "a".repeat(64),
            contentType: "text/markdown",
          },
        ],
      },
      {
        bypassGitHubAccountAge: true,
        bypassQualityGate: true,
        skipWebhook: true,
      },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categories: ["other"],
      }),
    );
  });

  it("uses Other when publish explicitly clears an existing category", async () => {
    const storedFiles = new Map([
      [
        "_storage:skill",
        `---
description: Research helper for literature reviews.
---
# Research Helper
`,
      ],
    ]);
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("version" in args && "embedding" in args) {
        return {
          skillId: "skills:demo",
          versionId: "skillVersions:demo",
          embeddingId: "skillEmbeddings:demo",
        };
      }
      return null;
    });
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "skills:demo",
          slug: "research-helper",
          displayName: "Research Helper",
          summary: "Research helper",
          ownerUserId: "users:1",
          latestVersionSummary: { version: "0.9.0" },
          categories: ["development"],
        })
        .mockResolvedValueOnce({ _id: "users:1", handle: "demo", createdAt: 1 }),
      runMutation,
      scheduler: { runAfter: vi.fn() },
      storage: {
        get: vi.fn(async (storageId: string) => {
          const content = storedFiles.get(storageId);
          return content === undefined ? null : new Blob([content]);
        }),
      },
    };

    await publishVersionForUser(
      ctx as never,
      "users:1" as never,
      {
        slug: "research-helper",
        displayName: "Research Helper",
        version: "1.0.0",
        changelog: "Clear categories",
        categories: [],
        files: [
          {
            path: "SKILL.md",
            size: 90,
            storageId: "_storage:skill" as never,
            sha256: "a".repeat(64),
            contentType: "text/markdown",
          },
        ],
      },
      {
        bypassGitHubAccountAge: true,
        bypassQualityGate: true,
        skipWebhook: true,
      },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categories: ["other"],
      }),
    );
  });

  it("schedules security scan enqueue after publish instead of awaiting it inline", async () => {
    const storedFiles = new Map([
      [
        "_storage:skill",
        `---
description: Security scanner smoke fixture.
---
# Security Scanner Smoke
`,
      ],
    ]);
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("version" in args && "embedding" in args) {
        return {
          skillId: "skills:demo",
          versionId: "skillVersions:demo",
          embeddingId: "skillEmbeddings:demo",
        };
      }
      throw new Error("publish should not await follow-up scan enqueue mutations");
    });
    const scheduler = { runAfter: vi.fn() };
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: "users:1", handle: "demo", createdAt: 1 }),
      runMutation,
      scheduler,
      storage: {
        get: vi.fn(async (storageId: string) => {
          const content = storedFiles.get(storageId);
          return content === undefined ? null : new Blob([content]);
        }),
      },
    };

    await publishVersionForUser(
      ctx as never,
      "users:1" as never,
      {
        slug: "security-scanner-smoke",
        displayName: "Security Scanner Smoke",
        version: "1.0.0",
        changelog: "Initial release",
        files: [
          {
            path: "SKILL.md",
            size: 90,
            storageId: "_storage:skill" as never,
            sha256: "a".repeat(64),
            contentType: "text/markdown",
          },
        ],
      },
      {
        bypassGitHubAccountAge: true,
        bypassQualityGate: true,
        skipWebhook: true,
      },
    );

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        versionId: "skillVersions:demo",
        source: "publish",
      }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      15_000,
      expect.anything(),
      expect.objectContaining({
        versionId: "skillVersions:demo",
        source: "publish",
        preserveActiveJob: true,
        preserveExistingJob: true,
      }),
    );
  });

  it("merges github source into metadata", () => {
    const merged = __test.mergeSourceIntoMetadata(
      { clawdis: { emoji: "x" } },
      {
        kind: "github",
        url: "https://github.com/a/b",
        repo: "a/b",
        ref: "main",
        commit: "0123456789012345678901234567890123456789",
        path: "skills/demo",
        importedAt: 123,
      },
    );
    expect((merged as Record<string, unknown>).clawdis).toEqual({ emoji: "x" });
    const source = (merged as Record<string, unknown>).source;
    expect(source).toEqual(
      expect.objectContaining({
        kind: "github",
        repo: "a/b",
        path: "skills/demo",
      }),
    );
  });

  it("excludes generated Skill Cards from the source fingerprint", async () => {
    const fingerprint = await __test.buildPublishSourceFingerprint([
      { path: "SKILL.md", sha256: "a".repeat(64) },
      { path: "skill-card.md", sha256: "b".repeat(64) },
    ]);
    const expected = await __test.buildPublishSourceFingerprint([
      { path: "SKILL.md", sha256: "a".repeat(64) },
    ]);

    expect(fingerprint).toBe(expected);
  });

  it("derives publish file metadata from stored bytes", async () => {
    const storage = {
      get: vi.fn(async () => new Blob(["hello"], { type: "text/markdown" })),
    };

    const files = await __test.derivePublishFilesFromStorage({ storage } as never, [
      {
        path: "SKILL.md",
        size: 1,
        storageId: "_storage:skill" as never,
        sha256: "caller-supplied",
        contentType: "text/plain",
      },
    ]);

    expect(files).toEqual([
      expect.objectContaining({
        path: "SKILL.md",
        storageId: "_storage:skill",
        size: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      }),
    ]);
  });

  it("rejects oversized stored files even when caller metadata is small", async () => {
    const storage = {
      get: vi.fn(async () => new Blob([new Uint8Array(MAX_PUBLISH_FILE_BYTES + 1)])),
    };

    await expect(
      __test.derivePublishFilesFromStorage({ storage } as never, [
        {
          path: "SKILL.md",
          size: 1,
          storageId: "_storage:skill" as never,
          sha256: "caller-supplied",
          contentType: "text/plain",
        },
      ]),
    ).rejects.toThrow(/exceeds 10MB limit/i);
  });

  it("rejects mutable GitHub remote references during skill publish", async () => {
    const storedFiles = new Map([
      [
        "_storage:skill",
        `---
description: Blocks mutable remote install references.
---
# Mutable Remote Skill

Install from https://raw.githubusercontent.com/acme/tool/main/install.sh
`,
      ],
    ]);
    const runMutation = vi.fn(async () => null);
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: "users:1", handle: "demo", createdAt: 1 }),
      runMutation,
      scheduler: { runAfter: vi.fn() },
      storage: {
        get: vi.fn(async (storageId: string) => {
          const content = storedFiles.get(storageId);
          return content === undefined ? null : new Blob([content]);
        }),
      },
    };

    await expect(
      publishVersionForUser(
        ctx as never,
        "users:1" as never,
        {
          slug: "mutable-remote-skill",
          displayName: "Mutable Remote Skill",
          version: "1.0.0",
          changelog: "Initial release",
          files: [
            {
              path: "SKILL.md",
              size: 180,
              storageId: "_storage:skill" as never,
              sha256: "a".repeat(64),
              contentType: "text/markdown",
            },
          ],
        },
        {
          bypassGitHubAccountAge: true,
          bypassQualityGate: true,
          skipWebhook: true,
        },
      ),
    ).rejects.toThrow("REMOTE_REFERENCE_UNPINNED_GITHUB");

    expect(runMutation).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("rejects publisher-authored skill-card.md files", async () => {
    const ctx = {
      runQuery: vi.fn(async () => null),
      storage: {
        get: vi.fn(async () => new Blob(["# Demo"])),
      },
    };

    await expect(
      publishVersionForUser(
        ctx as never,
        "users:1" as never,
        {
          slug: "demo",
          displayName: "Demo",
          version: "1.0.0",
          changelog: "Initial release",
          files: [
            {
              path: "SKILL.md",
              size: 6,
              storageId: "_storage:skill" as never,
              sha256: "a".repeat(64),
              contentType: "text/markdown",
            },
            {
              path: "skill-card.md",
              size: 11,
              storageId: "_storage:card" as never,
              sha256: "b".repeat(64),
              contentType: "text/markdown",
            },
          ],
        },
        {
          bypassGitHubAccountAge: true,
          bypassQualityGate: true,
        },
      ),
    ).rejects.toThrow(/skill-card\.md is generated by ClawHub/i);
  });

  it("rejects publisher-authored skill-card.md files with dot-prefixed paths", async () => {
    const ctx = {
      runQuery: vi.fn(async () => null),
      storage: {
        get: vi.fn(async () => new Blob(["# Demo"])),
      },
    };

    await expect(
      publishVersionForUser(
        ctx as never,
        "users:1" as never,
        {
          slug: "demo",
          displayName: "Demo",
          version: "1.0.0",
          changelog: "Initial release",
          files: [
            {
              path: "SKILL.md",
              size: 6,
              storageId: "_storage:skill" as never,
              sha256: "a".repeat(64),
              contentType: "text/markdown",
            },
            {
              path: "./skill-card.md",
              size: 11,
              storageId: "_storage:card" as never,
              sha256: "b".repeat(64),
              contentType: "text/markdown",
            },
          ],
        },
        {
          bypassGitHubAccountAge: true,
          bypassQualityGate: true,
        },
      ),
    ).rejects.toThrow(/skill-card\.md is generated by ClawHub/i);
  });

  it("rejects thin templated skill content for low-trust publishers", () => {
    const signals = __test.computeQualitySignals({
      readmeText: `---
description: Expert guidance for sushi-rolls.
---
# Sushi Rolls
## Getting Started
- Step-by-step tutorials
- Tips and techniques
- Project ideas
`,
      summary: "Expert guidance for sushi-rolls.",
    });

    const quality = __test.evaluateQuality({
      signals,
      trustTier: "low",
      similarRecentCount: 0,
    });

    expect(quality.decision).toBe("reject");
  });

  it("rejects repetitive structural spam bursts", () => {
    const signals = __test.computeQualitySignals({
      readmeText: `# Kitchen Workflow
## Mise en place
- Gather ingredients and check freshness for each item before prep starts.
- Prepare utensils and containers so every step can be executed smoothly.
- Keep notes on ingredient substitutions and expected flavor impact.
## Rolling flow
- Build rolls in small batches, taste often, and adjust seasoning carefully.
- Track timing, texture, and shape consistency to avoid rushed mistakes.
- Capture what worked and what failed so the next run is more reliable.
## Service checklist
- Plate with clear labels, cleaning steps, and handoff instructions.
- Include safety notes, storage guidance, and quality checkpoints.
- Document outcomes and follow-up improvements for the next iteration.
`,
      summary: "Detailed sushi workflow notes.",
    });

    const quality = __test.evaluateQuality({
      signals,
      trustTier: "low",
      similarRecentCount: 5,
    });

    expect(quality.decision).toBe("reject");
    expect(quality.reason).toContain("template spam");
  });

  it("does not undercount non-latin skill docs", () => {
    const signals = __test.computeQualitySignals({
      readmeText: `# 飞书图片助手
## 核心能力
- 上传本地图片到飞书并自动返回 image_key，避免重复上传浪费配额。
- 支持群聊与私聊，自动识别目标类型并校验参数，减少调用错误。
- 提供重试与错误分类，方便排查网络问题、权限问题与资源限制。
## 使用说明
先配置应用凭证，然后传入目标会话与文件路径。技能会先检查缓存，再执行上传，并在发送阶段附带日志说明，便于团队追踪。
如果出现失败，输出会包含建议动作，例如补齐权限、检查文件大小、确认机器人是否在群内，以及如何重放请求。
还会记录每一步耗时、返回码与上下文摘要，方便后续做性能分析、告警聚合和批量回放，避免同类问题反复出现。
`,
      summary: "上传并发送图片到飞书，支持缓存、重试和错误诊断。",
    });

    const quality = __test.evaluateQuality({
      signals,
      trustTier: "low",
      similarRecentCount: 0,
    });

    expect(signals.bodyWords).toBeGreaterThanOrEqual(45);
    expect(quality.decision).toBe("pass");
  });
});
