/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/apiTokenAuth", () => ({
  requireApiTokenUser: vi.fn(),
  getOptionalApiTokenUser: vi.fn(),
  getOptionalApiTokenUserId: vi.fn(),
  requirePackagePublishAuth: vi.fn(),
}));

vi.mock("./lib/githubActionsOidc", () => ({
  fetchGitHubRepositoryIdentity: vi.fn(),
  verifyGitHubActionsTrustedPublishJwt: vi.fn(),
}));

vi.mock("./skills", () => ({
  publishVersionForUser: vi.fn(),
}));

const { __handlers } = await import("./httpApiV1");

type ActionCtx = import("./_generated/server").ActionCtx;

const okRate = () => ({
  ok: true,
});

function makeCtx(partial: {
  runQuery?: (query: unknown, args: Record<string, unknown>) => unknown;
}) {
  const runQuery = vi.fn(async (query: unknown, args: Record<string, unknown>) => {
    return partial.runQuery ? await partial.runQuery(query, args) : null;
  });
  return { runQuery, runMutation: vi.fn().mockResolvedValue(okRate()) } as unknown as ActionCtx;
}

describe("ambiguous skill slug responses", () => {
  it("returns structured owner choices for slug-only skill detail requests", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      skill: null,
      ambiguous: true,
      ambiguousMatches: [
        { slug: "demo", ownerHandle: "openclaw" },
        { slug: "demo", ownerHandle: "patrick" },
      ],
    });
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/v1/skills/demo"),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "AMBIGUOUS_SKILL_SLUG",
      message: 'Found multiple skills with the slug "demo"; specify which one you want to install:',
      slug: "demo",
      matches: [
        {
          ownerHandle: "openclaw",
          slug: "demo",
          ref: "@openclaw/demo",
          url: "https://example.com/openclaw/demo",
        },
        {
          ownerHandle: "patrick",
          slug: "demo",
          ref: "@patrick/demo",
          url: "https://example.com/patrick/demo",
        },
      ],
    });
  });

  it("returns structured owner choices for package skill fallback requests", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        skill: null,
        ambiguous: true,
        ambiguousMatches: [
          { slug: "demo", ownerHandle: "openclaw" },
          { slug: "demo", ownerHandle: "patrick" },
        ],
      });
    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/v1/packages/demo"),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "AMBIGUOUS_SKILL_SLUG",
      message: 'Found multiple skills with the slug "demo"; specify which one you want to install:',
      slug: "demo",
      matches: [
        {
          ownerHandle: "openclaw",
          slug: "demo",
          ref: "@openclaw/demo",
          url: "https://example.com/openclaw/demo",
        },
        {
          ownerHandle: "patrick",
          slug: "demo",
          ref: "@patrick/demo",
          url: "https://example.com/patrick/demo",
        },
      ],
    });
  });
});
