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

  it("records zip downloads through the internal mutation path", async () => {
    class MockResponse {
      status: number;
      headers: Headers;

      constructor(_body?: BodyInit | null, init?: ResponseInit) {
        this.status = init?.status ?? 200;
        this.headers = new Headers(init?.headers);
      }
    }
    vi.stubGlobal("Response", MockResponse as unknown as typeof Response);

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
    const runMutation = vi.fn(async (mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return { mutation, args };
    });
    const storageGet = vi.fn().mockResolvedValue(new Blob(["hello"], { type: "text/markdown" }));

    const response = await downloadZipHandler(
      {
        runQuery,
        runMutation,
        storage: { get: storageGet },
      } as unknown as ActionCtx,
      new Request("https://example.com/api/v1/download?slug=demo", {
        headers: { "cf-connecting-ip": "1.2.3.4" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(storageGet).toHaveBeenCalledWith("_storage:1");

    const recordCalls = runMutation.mock.calls.filter(([, args]) => {
      if (!args || typeof args !== "object") return false;
      const value = args as Record<string, unknown>;
      return (
        value.skillId === "skills:1" &&
        typeof value.identityHash === "string" &&
        typeof value.hourStart === "number"
      );
    });
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0]?.[1]).toEqual({
      skillId: "skills:1",
      identityHash: expect.any(String),
      hourStart: expect.any(Number),
    });
  });
});
