/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getHeaderMock = vi.fn();
const getVercelOidcTokenMock = vi.fn();
const readBodyMock = vi.fn();
const captureSnapshotMock = vi.fn();
const sourcePolicyMock = vi.fn();

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeaderMock(...args),
  readBody: (...args: unknown[]) => readBodyMock(...args),
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: (...args: unknown[]) => getVercelOidcTokenMock(...args),
}));

vi.mock("./skillsShCatalogSource", () => ({
  captureSkillsShCatalogTestSnapshot: (...args: unknown[]) => captureSnapshotMock(...args),
  getSkillsShCatalogTestSourcePolicy: (...args: unknown[]) => sourcePolicyMock(...args),
}));

describe("skills.sh permanent Test operator route", () => {
  beforeEach(() => {
    getHeaderMock.mockReset();
    getVercelOidcTokenMock.mockReset();
    readBodyMock.mockReset();
    captureSnapshotMock.mockReset();
    sourcePolicyMock.mockReset();
    sourcePolicyMock.mockReturnValue({
      allowed: true,
      environment: "test",
      maxDiscoveryRows: 500,
      maxRealScanAdmissions: 10,
    });
    getHeaderMock.mockImplementation((_event: unknown, name: string) => {
      if (name === "authorization") return "Bearer operator-token";
      return undefined;
    });
    getVercelOidcTokenMock.mockResolvedValue("request-oidc-token");
    readBodyMock.mockResolvedValue({
      allowlist: ["nvidia/skills/aiq-deploy"],
      reason: "bounded Test proof",
    });
    captureSnapshotMock.mockImplementation(async (options) => {
      expect(await options.getOidcToken()).toBe("request-oidc-token");
      expect(options.admitExternalIds).toEqual(["nvidia/skills/aiq-deploy"]);
      expect(await options.resolveGitHubOwners(["anthropics", "nvidia"])).toEqual({
        authentication: "clawhub-github-authenticated",
        fetches: 2,
        owners: [
          { owner: "anthropics", login: "anthropics", id: 76_263_028 },
          { owner: "nvidia", login: "nvidia", id: 1_728_152 },
        ],
      });
      return {
        snapshotId: "skills-sh-test-live-500:abc",
        capturedAt: "2026-07-21T00:00:00.000Z",
        rows: Array.from({ length: 500 }, (_, index) => ({
          externalId: `owner/repo/skill-${index}`,
        })),
        artifacts: [
          {
            externalId: "nvidia/skills/aiq-deploy",
            artifactContentHash: "a".repeat(64),
            files: [],
          },
        ],
        verifiedIdentity: {
          ownerId: "team",
          projectId: "project",
          environment: "preview",
        },
        selection: {
          rows: 500,
          nvidiaRows: 10,
          requiredCollisionIds: [],
        },
        metrics: {
          runtimeMs: 100,
          skillsShFetches: 502,
          listFetches: 1,
          searchFetches: 1,
          detailFetches: 500,
          githubOwnerFetches: 2,
        },
      };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "GET") {
          return new Response(
            JSON.stringify({
              deploymentName: "academic-chihuahua-392",
              buildSha: "source-sha",
              control: {
                mode: "staging-live",
                discoveryEnabled: true,
                writesEnabled: true,
                scanPlanningEnabled: true,
                maxEntriesPerRun: 500,
                maxEntriesPerBatch: 100,
                maxWritesPerBatch: 100,
                publicVisibilityEnabled: false,
              },
            }),
          );
        }
        const body = JSON.parse(String(init.body)) as { operation: string; cursor?: number };
        if (body.operation === "start") {
          return new Response(JSON.stringify({ runId: "skillsShCatalogRuns:test" }));
        }
        if (body.operation === "resolve-owners") {
          return new Response(
            JSON.stringify({
              authentication: "clawhub-github-authenticated",
              fetches: 2,
              owners: [
                { owner: "anthropics", login: "anthropics", id: 76_263_028 },
                { owner: "nvidia", login: "nvidia", id: 1_728_152 },
              ],
            }),
          );
        }
        if (body.operation === "batch") {
          return new Response(
            JSON.stringify({
              status: body.cursor === 450 ? "completed" : "running",
              cursor: (body.cursor ?? 0) + 50,
            }),
          );
        }
        if (body.operation === "admit") {
          return new Response(JSON.stringify({ requested: 1, admitted: 1, skipped: 0 }));
        }
        return new Response(JSON.stringify({ error: "unsupported_operation" }), { status: 400 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves owners through Convex and never exposes the request OIDC token", async () => {
    const handler = (await import("./routes/ops/skills-sh/catalog-test.post")).default;
    const response = (await handler({} as never)) as Response;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      source: { selection: { rows: 500 }, fetches: { skillsShFetches: 502 } },
      convex: {
        firstRun: { runId: "skillsShCatalogRuns:test" },
        identicalRerun: { runId: "skillsShCatalogRuns:test" },
        admission: { admitted: 1 },
      },
      controls: { publicVisibilityEnabled: false, schedulesEnabled: false },
    });
    expect(JSON.stringify(body)).not.toContain("request-oidc-token");

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(25);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer operator-token" });
      expect(JSON.stringify(init)).not.toContain("request-oidc-token");
    }
    expect(
      fetchMock.mock.calls.some(([, init]) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        return body?.operation === "admit";
      }),
    ).toBe(true);
  });

  it("is a hard 404 outside the exact Test runtime", async () => {
    sourcePolicyMock.mockReturnValue({
      allowed: false,
      environment: "production",
      reason: "disabled",
    });
    const handler = (await import("./routes/ops/skills-sh/catalog-test.post")).default;
    const response = (await handler({} as never)) as Response;
    expect(response.status).toBe(404);
    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sizes persistence batches from the active Convex row and write budgets", async () => {
    readBodyMock.mockResolvedValue({
      allowlist: ["nvidia/skills/aiq-deploy"],
      reason: "bounded Test proof",
    });
    const batchSizes: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "GET") {
          return new Response(
            JSON.stringify({
              deploymentName: "academic-chihuahua-392",
              buildSha: "source-sha",
              control: {
                mode: "staging-live",
                discoveryEnabled: true,
                writesEnabled: true,
                scanPlanningEnabled: true,
                maxEntriesPerRun: 500,
                maxEntriesPerBatch: 20,
                maxWritesPerBatch: 30,
                publicVisibilityEnabled: false,
              },
            }),
          );
        }
        const body = JSON.parse(String(init.body)) as {
          operation: string;
          cursor?: number;
          rows?: unknown[];
        };
        if (body.operation === "start") {
          return new Response(JSON.stringify({ runId: "skillsShCatalogRuns:test" }));
        }
        if (body.operation === "resolve-owners") {
          return new Response(
            JSON.stringify({
              authentication: "clawhub-github-authenticated",
              fetches: 2,
              owners: [
                { owner: "anthropics", login: "anthropics", id: 76_263_028 },
                { owner: "nvidia", login: "nvidia", id: 1_728_152 },
              ],
            }),
          );
        }
        if (body.operation === "batch") {
          batchSizes.push(body.rows?.length ?? 0);
          return new Response(
            JSON.stringify({
              status:
                (body.cursor ?? 0) + (body.rows?.length ?? 0) >= 500 ? "completed" : "running",
              cursor: (body.cursor ?? 0) + (body.rows?.length ?? 0),
            }),
          );
        }
        if (body.operation === "admit") {
          return new Response(JSON.stringify({ requested: 1, admitted: 1, skipped: 0 }));
        }
        return new Response(JSON.stringify({ error: "unsupported_operation" }), { status: 400 });
      }),
    );

    const handler = (await import("./routes/ops/skills-sh/catalog-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      controls: { batchSize: 15 },
    });
    expect(batchSizes).toHaveLength(68);
    expect(Math.max(...batchSizes)).toBe(15);
    expect(batchSizes.reduce((sum, size) => sum + size, 0)).toBe(1_000);
  });
});
