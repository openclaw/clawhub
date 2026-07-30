/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getHeaderMock = vi.fn();
const getVercelOidcTokenMock = vi.fn();
const readBodyMock = vi.fn();
const buildProofSnapshotIdMock = vi.fn();
const measureProofSourceMock = vi.fn();
const parseProofSnapshotIdMock = vi.fn();
const productionPolicyMock = vi.fn();

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeaderMock(...args),
  readBody: (...args: unknown[]) => readBodyMock(...args),
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: (...args: unknown[]) => getVercelOidcTokenMock(...args),
}));

vi.mock("./skillsShCatalogSource", () => ({
  buildSkillsShMirrorProofSnapshotId: (...args: unknown[]) => buildProofSnapshotIdMock(...args),
  fetchSkillsShMirrorBatch: vi.fn(),
  fetchSkillsShMirrorControlledBatch: vi.fn(),
  getSkillsShCatalogProductionSourcePolicy: (...args: unknown[]) => productionPolicyMock(...args),
  getSkillsShCatalogTestSourcePolicy: vi.fn(),
  measureSkillsShMirrorProofSource: (...args: unknown[]) => measureProofSourceMock(...args),
  measureSkillsShTrendingSource: vi.fn(),
  parseSkillsShMirrorProofSnapshotId: (...args: unknown[]) => parseProofSnapshotIdMock(...args),
  skillsShSourceRetryAfterSeconds: vi.fn(() => null),
}));

vi.mock("./skillsShMirrorClassification", () => ({
  buildSkillsShMirrorReplayRows: vi.fn(),
  enrichSkillsShMirrorClassifications: vi.fn(),
}));

describe("skills.sh production mirror route", () => {
  beforeEach(() => {
    vi.resetModules();
    getHeaderMock.mockReset();
    getVercelOidcTokenMock.mockReset();
    readBodyMock.mockReset();
    buildProofSnapshotIdMock.mockReset();
    measureProofSourceMock.mockReset();
    parseProofSnapshotIdMock.mockReset();
    productionPolicyMock.mockReset();
    productionPolicyMock.mockReturnValue({ allowed: true, environment: "production" });
    getHeaderMock.mockReturnValue("Bearer github-actions-oidc");
    getVercelOidcTokenMock.mockResolvedValue("vercel-production-oidc");
    buildProofSnapshotIdMock.mockReturnValue("skills-sh:proof:production");
    parseProofSnapshotIdMock.mockReturnValue({
      catalogTotal: 9_575,
      controlledExternalIds: [],
      controlledOverlayExternalIds: [],
      controlledSupplementExternalIds: [],
      sourceSnapshotHash: "a".repeat(64),
    });
  });

  it("forwards the GitHub Actions OIDC token only to the exact production operator", async () => {
    readBodyMock.mockResolvedValue({ operation: "status" });
    const convexFetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://wry-manatee-359.convex.site/api/v1/operator/skills-sh/mirror");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer github-actions-oidc",
      });
      expect(JSON.parse(String(init.body))).toEqual({ operation: "mirror-status" });
      return new Response(JSON.stringify({ control: null, runs: [] }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ control: null, runs: [] });
    expect(productionPolicyMock).toHaveBeenCalledOnce();
    expect(convexFetch).toHaveBeenCalledOnce();
  });

  it("fails closed before the operator call when the production source policy is not exact", async () => {
    productionPolicyMock.mockReturnValue({
      allowed: false,
      environment: "production",
      reason: "wrong production backend",
    });
    readBodyMock.mockResolvedValue({ operation: "status" });
    const convexFetch = vi.fn();
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(convexFetch).not.toHaveBeenCalled();
  });

  it("configures production with the production-only confirmation", async () => {
    readBodyMock.mockResolvedValue({
      operation: "configure",
      enabled: true,
      reason: "hourly production sync",
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({
        operation: "mirror-configure",
        confirm: "enable-skills-sh-mirror-production",
        enabled: true,
        reason: "hourly production sync",
      });
      return new Response(JSON.stringify({ enabled: true }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
  });

  it("measures the raw production corpus without controlled Test supplements", async () => {
    readBodyMock.mockResolvedValue({ operation: "start", reason: "initial hidden import" });
    measureProofSourceMock.mockResolvedValue({
      catalogTotal: 9_575,
      controlledExternalIds: ["patrick-erichsen/skills/html"],
      controlledOverlayExternalIds: [],
      controlledSupplementExternalIds: ["patrick-erichsen/skills/html"],
      sourceRequests: 21,
      sourcePages: [
        {
          page: 0,
          sourceTotal: 9_575,
          pageLength: 500,
          hasMore: true,
          identityHash: "identity",
          contentHash: "content",
          sourceBytes: 100,
          serializedBytes: 120,
          rows: [],
        },
      ],
      evidence: { pagination: { requestedPages: [] } },
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-status") {
        return new Response(JSON.stringify({ runs: [] }));
      }
      if (body.operation === "mirror-source-page-store") {
        return new Response(JSON.stringify({ stored: true }));
      }
      if (body.operation === "mirror-source-summary") {
        return new Response(JSON.stringify({ rows: 500 }));
      }
      expect(body).toMatchObject({
        operation: "mirror-start",
        sourceView: "leaderboard",
        sourceTotal: 9_575,
        snapshotId: "skills-sh:proof:production",
      });
      return new Response(
        JSON.stringify({ runId: "skillsShMirrorRuns:production", status: "running" }),
      );
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceTotal: 9_575,
      sourceCatalogTotal: 9_575,
      controlledOverlayTotal: 0,
      controlledSupplementTotal: 0,
    });
    expect(buildProofSnapshotIdMock).toHaveBeenCalledWith({
      catalogTotal: 9_575,
      controlledExternalIds: [],
      controlledOverlayExternalIds: [],
      controlledSupplementExternalIds: [],
      evidence: { pagination: { requestedPages: [] } },
    });
  });

  it("uses distinct production confirmations for activation and rollback", async () => {
    const forwarded: Array<Record<string, unknown>> = [];
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      forwarded.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }));
    });
    vi.stubGlobal("fetch", convexFetch);
    const handler = (await import("./routes/ops/skills-sh/mirror.post")).default;

    readBodyMock.mockResolvedValueOnce({
      operation: "verify-activate",
      reason: "verified initial production import",
    });
    expect(((await handler({} as never)) as Response).status).toBe(200);

    readBodyMock.mockResolvedValueOnce({
      operation: "deactivate",
      reason: "systemic production rollback",
    });
    expect(((await handler({} as never)) as Response).status).toBe(200);

    expect(forwarded).toEqual([
      {
        operation: "mirror-verify-activate",
        reason: "verified initial production import",
        confirm: "activate-skills-sh-public-production",
      },
      {
        operation: "mirror-public-gate",
        enabled: false,
        reason: "systemic production rollback",
        confirm: "deactivate-skills-sh-public-production",
      },
    ]);
  });
});
