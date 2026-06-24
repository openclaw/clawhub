import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { __test, downloadZipHandler } from "./downloads";

type RateLimitArgs = { key: string; limit: number; windowMs: number };

function isRateLimitArgs(args: unknown): args is RateLimitArgs {
  if (!args || typeof args !== "object") return false;
  const value = args as Record<string, unknown>;
  return (
    typeof value.key === "string" &&
    typeof value.limit === "number" &&
    typeof value.windowMs === "number"
  );
}

const okRate = () => ({
  allowed: true,
  remaining: 10,
  limit: 100,
  resetAt: Date.now() + 60_000,
});

function stubZipResponse() {
  class MockResponse {
    status: number;
    headers: Headers;

    constructor(_body?: BodyInit | null, init?: ResponseInit) {
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers);
    }
  }
  vi.stubGlobal("Response", MockResponse as unknown as typeof Response);
}

describe("downloads helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("calculates hour start boundaries", () => {
    const hour = 3_600_000;
    expect(__test.getHourStart(0)).toBe(0);
    expect(__test.getHourStart(hour - 1)).toBe(0);
    expect(__test.getHourStart(hour)).toBe(hour);
    expect(__test.getHourStart(hour + 1)).toBe(hour);
  });

  it("prefers user identity when token user exists", () => {
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    expect(__test.getDownloadIdentityValue(request, "users_123")).toBe("user:users_123");
  });

  it("uses cf-connecting-ip for anonymous identity", () => {
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    expect(__test.getDownloadIdentityValue(request, null)).toBe("ip:1.2.3.4");
  });

  it("falls back to forwarded ip when explicitly enabled", () => {
    vi.stubEnv("TRUST_FORWARDED_IPS", "true");
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2" },
    });
    expect(__test.getDownloadIdentityValue(request, null)).toBe("ip:10.0.0.1");
  });

  it("returns null when user and ip are missing", () => {
    const request = new Request("https://example.com");
    expect(__test.getDownloadIdentityValue(request, null)).toBeNull();
  });

  it("schedules zip download stats outside the response path", async () => {
    stubZipResponse();

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            ownerUserId: "users:1",
            slug: "demo",
            tags: {},
            latestVersionId: "skillVersions:1",
          },
          moderationInfo: null,
        };
      }
      if ("versionId" in args) {
        return {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
          createdAt: 3,
          files: [{ path: "SKILL.md", storageId: "_storage:1" }],
          softDeletedAt: undefined,
        };
      }
      return null;
    });
    const runMutation = vi.fn(async (mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return { mutation, args };
    });
    const runAfter = vi.fn();
    const storageGet = vi.fn().mockResolvedValue(new Blob(["hello"], { type: "text/markdown" }));

    const response = await downloadZipHandler(
      {
        runQuery,
        runMutation,
        scheduler: { runAfter },
        storage: { get: storageGet },
      } as unknown as ActionCtx,
      new Request("https://example.com/api/v1/download?slug=demo", {
        headers: { "cf-connecting-ip": "1.2.3.4" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(storageGet).toHaveBeenCalledWith("_storage:1");

    const recordCalls = runAfter.mock.calls.filter(([, , args]) => {
      if (!args || typeof args !== "object") return false;
      const value = args as Record<string, unknown>;
      return (
        typeof value.target === "object" &&
        typeof value.identityHash === "string" &&
        value.identityKind === "ip" &&
        typeof value.dayStart === "number"
      );
    });
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0]?.[0]).toEqual(expect.any(Number));
    expect(recordCalls[0]?.[0]).toBeGreaterThanOrEqual(0);
    expect(recordCalls[0]?.[0]).toBeLessThan(60_000);
    expect(recordCalls[0]?.[2]).toEqual({
      target: { kind: "skill", id: "skills:1" },
      identityKind: "ip",
      identityHash: expect.any(String),
      dayStart: expect.any(Number),
      occurredAt: expect.any(Number),
    });
  });

  it("threads owner handle through the skill lookup", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            ownerUserId: "users:1",
            slug: "demo",
            tags: {},
            latestVersionId: "skillVersions:1",
          },
          moderationInfo: null,
        };
      }
      if ("versionId" in args) {
        return {
          _id: "skillVersions:1",
          version: "1.0.0",
          createdAt: 3,
          files: [{ path: "SKILL.md", storageId: "_storage:1" }],
          softDeletedAt: undefined,
        };
      }
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return null;
    });

    await downloadZipHandler(
      {
        runQuery,
        runMutation,
        scheduler: { runAfter: vi.fn() },
        storage: { get: vi.fn().mockResolvedValue(new Blob(["hello"])) },
      } as unknown as ActionCtx,
      new Request("https://example.com/api/v1/download?slug=demo&ownerHandle=clawkit"),
    );

    const skillLookup = runQuery.mock.calls.find(([, args]) => {
      const value = args as Record<string, unknown>;
      return value.slug === "demo";
    });
    expect(skillLookup?.[1]).toEqual(
      expect.objectContaining({ slug: "demo", ownerHandle: "clawkit" }),
    );
  });

  it("does not serve a tag that points at another skill's version", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            ownerUserId: "users:1",
            slug: "demo",
            tags: { old: "skillVersions:other" },
            latestVersionId: "skillVersions:1",
          },
          moderationInfo: null,
        };
      }
      if (args.versionId === "skillVersions:1") {
        return {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
          createdAt: 3,
          files: [],
          softDeletedAt: undefined,
        };
      }
      if (args.versionId === "skillVersions:other") {
        return {
          _id: "skillVersions:other",
          skillId: "skills:other",
          version: "9.9.9",
          createdAt: 4,
          files: [{ path: "SKILL.md", storageId: "_storage:other" }],
          softDeletedAt: undefined,
        };
      }
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return null;
    });
    const storageGet = vi.fn();

    const response = await downloadZipHandler(
      {
        runQuery,
        runMutation,
        scheduler: { runAfter: vi.fn() },
        storage: { get: storageGet },
      } as unknown as ActionCtx,
      new Request("https://example.com/api/v1/download?slug=demo&tag=old", {
        headers: { "cf-connecting-ip": "1.2.3.4" },
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Version not found");
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("returns ownerHandle guidance when a slug-only download is ambiguous", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      if ("slug" in args) return { skill: null, ambiguous: true };
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return null;
    });

    const response = await downloadZipHandler(
      {
        runQuery,
        runMutation,
        scheduler: { runAfter: vi.fn() },
        storage: { get: vi.fn() },
      } as unknown as ActionCtx,
      new Request("https://example.com/api/v1/download?slug=demo"),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.text();
    expect(body).toContain('Ambiguous skill slug "demo"');
    expect(body).toContain("/api/v1/download?slug=demo&ownerHandle=<owner>");
  });

  it("blocks the exact requested skill version when its ClawScan verdict is malicious", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            ownerUserId: "users:1",
            slug: "demo",
            tags: {},
            latestVersionId: "skillVersions:2",
          },
          moderationInfo: {
            isMalwareBlocked: false,
            isPendingScan: false,
            isHiddenByMod: false,
            isRemoved: false,
          },
        };
      }
      if ("skillId" in args && "version" in args) {
        return {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
          createdAt: 3,
          files: [{ path: "SKILL.md", storageId: "_storage:bad" }],
          softDeletedAt: undefined,
          llmAnalysis: {
            status: "completed",
            verdict: "malicious",
            checkedAt: 4,
          },
        };
      }
      if (args.versionId === "skillVersions:2") {
        return {
          _id: "skillVersions:2",
          skillId: "skills:1",
          version: "1.0.1",
          createdAt: 5,
          files: [],
          softDeletedAt: undefined,
          llmAnalysis: {
            status: "completed",
            verdict: "clean",
            checkedAt: 6,
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return null;
    });
    const storageGet = vi.fn();

    const response = await downloadZipHandler(
      {
        runQuery,
        runMutation,
        scheduler: { runAfter: vi.fn() },
        storage: { get: storageGet },
      } as unknown as ActionCtx,
      new Request("https://example.com/api/v1/download?slug=demo&version=1.0.0", {
        headers: { "cf-connecting-ip": "1.2.3.4" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(
      "Blocked: this skill version has been flagged as malicious by ClawScan and cannot be downloaded.",
    );
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("uses API token user identity for zip download stats when present", async () => {
    stubZipResponse();

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      if ("tokenHash" in args) {
        return { _id: "apiTokens:1", revokedAt: undefined };
      }
      if ("tokenId" in args) {
        return { _id: "users:token", deletedAt: undefined, deactivatedAt: undefined };
      }
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            ownerUserId: "users:1",
            slug: "demo",
            tags: {},
            latestVersionId: "skillVersions:1",
          },
          moderationInfo: null,
        };
      }
      if ("versionId" in args) {
        return {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
          createdAt: 3,
          files: [{ path: "SKILL.md", storageId: "_storage:1" }],
          softDeletedAt: undefined,
        };
      }
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return { tokenTouched: "tokenId" in args };
    });
    const runAfter = vi.fn();
    const storageGet = vi.fn().mockResolvedValue(new Blob(["hello"], { type: "text/markdown" }));

    const response = await downloadZipHandler(
      {
        runQuery,
        runMutation,
        scheduler: { runAfter },
        storage: { get: storageGet },
      } as unknown as ActionCtx,
      new Request("https://example.com/api/v1/download?slug=demo", {
        headers: {
          authorization: "Bearer clh_test",
          "cf-connecting-ip": "1.2.3.4",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(runAfter).toHaveBeenCalledWith(
      expect.any(Number),
      expect.anything(),
      expect.objectContaining({
        target: { kind: "skill", id: "skills:1" },
        identityKind: "user",
        identityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("returns zip downloads when download metering is scheduled", async () => {
    stubZipResponse();

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            ownerUserId: "users:1",
            slug: "demo",
            tags: {},
            latestVersionId: "skillVersions:1",
          },
          moderationInfo: null,
        };
      }
      if ("versionId" in args) {
        return {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
          createdAt: 3,
          files: [{ path: "SKILL.md", storageId: "_storage:1" }],
          softDeletedAt: undefined,
        };
      }
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return { mutationRecorded: true };
    });
    const runAfter = vi.fn();
    const storageGet = vi.fn().mockResolvedValue(new Blob(["hello"], { type: "text/markdown" }));

    const response = await downloadZipHandler(
      {
        runQuery,
        runMutation,
        scheduler: { runAfter },
        storage: { get: storageGet },
      } as unknown as ActionCtx,
      new Request("https://example.com/api/v1/download?slug=demo", {
        headers: { "cf-connecting-ip": "1.2.3.4" },
      }),
    );

    expect(response.status).toBe(200);
    expect(runAfter).toHaveBeenCalledWith(
      expect.any(Number),
      expect.anything(),
      expect.objectContaining({
        target: { kind: "skill", id: "skills:1" },
        identityKind: "ip",
        identityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it.each(["clean", "suspicious"] as const)(
    "returns a metered public GitHub handoff descriptor for %s scan without scan metadata",
    async (scanStatus) => {
      const commit = "1".repeat(40);
      const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
        if (isRateLimitArgs(args)) return okRate();
        if ("slug" in args) {
          return {
            skill: {
              _id: "skills:github",
              ownerUserId: "users:1",
              slug: "aiq-deploy",
              tags: {},
              latestVersionId: undefined,
              installKind: "github",
              githubPath: "skills/aiq-deploy",
              githubCurrentCommit: commit,
              githubCurrentContentHash: "hash-aiq-deploy",
              githubCurrentStatus: "present",
              githubScanStatus: scanStatus,
            },
            moderationInfo: null,
          };
        }
        if ("skillId" in args) {
          return {
            installKind: "github",
            repo: "NVIDIA/skills",
            path: "skills/aiq-deploy",
            commit,
            contentHash: "hash-aiq-deploy",
            currentStatus: "present",
            scanStatus,
            removedAt: null,
          };
        }
        return null;
      });
      const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
        if (isRateLimitArgs(args)) return okRate();
        return null;
      });
      const runAfter = vi.fn();
      const storageGet = vi.fn();

      const response = await downloadZipHandler(
        {
          runQuery,
          runMutation,
          scheduler: { runAfter },
          storage: { get: storageGet },
        } as unknown as ActionCtx,
        new Request("https://example.com/api/v1/download?slug=aiq-deploy", {
          headers: { "cf-connecting-ip": "1.2.3.4" },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(storageGet).not.toHaveBeenCalled();

      const body = await response.json();
      expect(body).toEqual({
        sourceRef: "public-github",
        repo: "NVIDIA/skills",
        commit,
        path: "skills/aiq-deploy",
        contentHash: "hash-aiq-deploy",
        archiveUrl: `https://api.github.com/repos/NVIDIA/skills/zipball/${commit}`,
      });
      expect(body).not.toHaveProperty("scan");
      expect(body).not.toHaveProperty("scanStatus");

      expect(runAfter).toHaveBeenCalledWith(
        expect.any(Number),
        expect.anything(),
        expect.objectContaining({
          target: { kind: "skill", id: "skills:github" },
          identityKind: "ip",
          identityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
    },
  );

  it.each([
    {
      name: "pending scan",
      skill: { githubCurrentStatus: "present", githubScanStatus: "pending" },
      source: { repo: "NVIDIA/skills" },
      status: 423,
      message: "GitHub-backed skill security scan is in progress.",
    },
    {
      name: "failed scan",
      skill: { githubCurrentStatus: "present", githubScanStatus: "failed" },
      source: { repo: "NVIDIA/skills" },
      status: 403,
      message: "GitHub-backed skill failed ClawHub security scanning.",
    },
    {
      name: "malicious scan",
      skill: { githubCurrentStatus: "present", githubScanStatus: "malicious" },
      source: { repo: "NVIDIA/skills" },
      status: 403,
      message: "GitHub-backed skill failed ClawHub security scanning.",
    },
    {
      name: "missing upstream path",
      skill: { githubCurrentStatus: "missing", githubScanStatus: "clean" },
      source: { repo: "NVIDIA/skills" },
      status: 410,
      message: "GitHub-backed skill path is missing upstream.",
    },
    {
      name: "removed upstream path",
      skill: { githubCurrentStatus: "present", githubRemovedAt: 123, githubScanStatus: "clean" },
      source: { repo: "NVIDIA/skills" },
      status: 410,
      message: "GitHub-backed skill has been removed upstream.",
    },
    {
      name: "unknown upstream freshness",
      skill: { githubCurrentStatus: "unknown", githubScanStatus: "clean" },
      source: { repo: "NVIDIA/skills" },
      status: 423,
      message: "GitHub-backed skill needs an upstream freshness check before download.",
    },
    {
      name: "incomplete source",
      skill: { githubCurrentStatus: "present", githubScanStatus: "clean" },
      source: null,
      status: 409,
      message: "GitHub-backed skill source metadata is incomplete.",
    },
  ])(
    "blocks $name GitHub handoffs without scheduling metrics",
    async ({ skill, source, status, message }) => {
      const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
        if (isRateLimitArgs(args)) return okRate();
        if ("slug" in args) {
          return {
            skill: {
              _id: "skills:github",
              ownerUserId: "users:1",
              slug: "aiq-deploy",
              tags: {},
              latestVersionId: undefined,
              installKind: "github",
              githubPath: "skills/aiq-deploy",
              githubCurrentCommit: "1".repeat(40),
              githubCurrentContentHash: "hash-aiq-deploy",
              ...skill,
            },
            moderationInfo: null,
          };
        }
        if ("skillId" in args) {
          if (!source) return null;
          return {
            installKind: "github",
            repo: source.repo,
            path: "skills/aiq-deploy",
            commit: "1".repeat(40),
            contentHash: "hash-aiq-deploy",
            currentStatus: "present",
            scanStatus: "clean",
            removedAt: null,
            ...skill,
            ...(skill.githubCurrentStatus ? { currentStatus: skill.githubCurrentStatus } : {}),
            ...(skill.githubScanStatus ? { scanStatus: skill.githubScanStatus } : {}),
            ...(skill.githubRemovedAt ? { removedAt: skill.githubRemovedAt } : {}),
          };
        }
        return null;
      });
      const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
        if (isRateLimitArgs(args)) return okRate();
        return null;
      });
      const runAfter = vi.fn();

      const response = await downloadZipHandler(
        {
          runQuery,
          runMutation,
          scheduler: { runAfter },
          storage: { get: vi.fn() },
        } as unknown as ActionCtx,
        new Request("https://example.com/api/v1/download?slug=aiq-deploy", {
          headers: { "cf-connecting-ip": "1.2.3.4" },
        }),
      );

      expect(response.status).toBe(status);
      expect(await response.text()).toBe(message);
      expect(runAfter).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: "hidden by moderators",
      moderationInfo: {
        isPendingScan: false,
        isMalwareBlocked: false,
        isHiddenByMod: true,
        isRemoved: false,
      },
      status: 403,
      message: "This skill is currently unavailable.",
    },
    {
      name: "removed by moderators",
      moderationInfo: {
        isPendingScan: false,
        isMalwareBlocked: false,
        isHiddenByMod: false,
        isRemoved: true,
      },
      status: 410,
      message: "This skill has been removed by a moderator.",
    },
  ])(
    "blocks $name GitHub handoffs before source descriptor creation",
    async ({ moderationInfo, status, message }) => {
      const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
        if (isRateLimitArgs(args)) return okRate();
        if ("slug" in args) {
          return {
            skill: {
              _id: "skills:github",
              ownerUserId: "users:1",
              slug: "aiq-deploy",
              tags: {},
              latestVersionId: undefined,
              installKind: "github",
              githubPath: "skills/aiq-deploy",
              githubCurrentCommit: "1".repeat(40),
              githubCurrentContentHash: "hash-aiq-deploy",
              githubCurrentStatus: "present",
              githubScanStatus: "clean",
            },
            moderationInfo,
          };
        }
        if ("skillId" in args) {
          return {
            installKind: "github",
            repo: "NVIDIA/skills",
            path: "skills/aiq-deploy",
            commit: "1".repeat(40),
            contentHash: "hash-aiq-deploy",
            currentStatus: "present",
            scanStatus: "clean",
            removedAt: null,
          };
        }
        return null;
      });
      const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
        if (isRateLimitArgs(args)) return okRate();
        return null;
      });
      const runAfter = vi.fn();

      const response = await downloadZipHandler(
        {
          runQuery,
          runMutation,
          scheduler: { runAfter },
          storage: { get: vi.fn() },
        } as unknown as ActionCtx,
        new Request("https://example.com/api/v1/download?slug=aiq-deploy", {
          headers: { "cf-connecting-ip": "1.2.3.4" },
        }),
      );

      expect(response.status).toBe(status);
      expect(await response.text()).toBe(message);
      expect(runQuery).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ skillId: "skills:github" }),
      );
      expect(runAfter).not.toHaveBeenCalled();
    },
  );
});
