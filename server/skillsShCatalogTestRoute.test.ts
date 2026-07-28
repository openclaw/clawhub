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

function controlledCanaryFetch(
  identicalCounts: Record<string, number> = {
    observed: 1,
    inserted: 0,
    updated: 0,
    unchanged: 1,
    scansPlanned: 0,
    scansAdmitted: 0,
  },
) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === "GET") {
      return new Response(
        JSON.stringify({
          deploymentName: "academic-chihuahua-392",
          buildSha: "canary-sha",
          control: {
            mode: "fixture",
            discoveryEnabled: true,
            writesEnabled: true,
            scanPlanningEnabled: true,
            scanAdmissionEnabled: false,
            publicVisibilityEnabled: false,
            maxEntriesPerRun: 1,
            maxEntriesPerBatch: 1,
            maxWritesPerBatch: 2,
            maxPlannedScans: 1,
            maxScanAdmissionsPerBatch: 0,
            maxScanAdmissionsPerRun: 0,
            maxScanAdmissionsPerDay: 0,
            maxCatalogQueued: 0,
            maxCatalogInFlight: 0,
          },
        }),
      );
    }
    const body = JSON.parse(String(init.body)) as {
      operation: string;
      runId?: string;
      reason?: string;
    };
    if (body.operation === "start-canary") {
      return new Response(
        JSON.stringify({
          runId: `skillsShCatalogRuns:${body.reason?.includes("identical") ? "repeat" : "first"}`,
          sourceVerification: {
            externalId: "patrick-erichsen/skills/html",
            githubOwnerId: 20_157_849,
            githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
            githubContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
            githubFetches: 4,
          },
        }),
      );
    }
    if (body.operation === "process-fixture") {
      const firstRun = body.runId?.endsWith("first");
      return new Response(
        JSON.stringify({
          status: "completed",
          cursor: 1,
          counts: firstRun
            ? {
                observed: 1,
                inserted: 1,
                updated: 0,
                unchanged: 0,
                scansPlanned: 1,
                scansAdmitted: 0,
              }
            : identicalCounts,
        }),
      );
    }
    if (body.operation === "reconcile") {
      return new Response(
        JSON.stringify({
          reconciled: true,
          mismatches: [],
          entries: [
            {
              externalId: "patrick-erichsen/skills/html",
              publicVisible: false,
              resolution: { installable: false },
            },
          ],
        }),
      );
    }
    return new Response(JSON.stringify({ error: "unsupported_operation" }), { status: 400 });
  });
}

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
        provenance: "stored-authenticated-staging-live",
        fetches: 0,
        reused: 2,
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
          environment: "test",
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
          githubOwnerFetches: 0,
          githubOwnerIdsReused: 2,
          githubOwnerProofProvenance: "stored-authenticated-staging-live",
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
              provenance: "stored-authenticated-staging-live",
              fetches: 0,
              reused: 2,
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
      source: {
        selection: { rows: 500 },
        fetches: {
          skillsShFetches: 502,
          githubOwnerFetches: 0,
          githubOwnerIdsReused: 2,
          githubOwnerProofProvenance: "stored-authenticated-staging-live",
        },
      },
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

  it("applies and reconciles the one-row controlled canary without OIDC or scan admission", async () => {
    readBodyMock.mockResolvedValue({
      mode: "controlled-canary",
      reason: "CLAW-557 hidden metadata canary",
    });
    vi.stubGlobal("fetch", controlledCanaryFetch());

    const handler = (await import("./routes/ops/skills-sh/catalog-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      mode: "controlled-canary",
      source: {
        externalId: "patrick-erichsen/skills/html",
        githubOwnerId: 20_157_849,
        githubFetches: 4,
      },
      convex: {
        firstRun: {
          run: { counts: { inserted: 1, scansAdmitted: 0 } },
          reconciliation: { reconciled: true, mismatches: [] },
        },
        identicalRerun: {
          run: { counts: { unchanged: 1, scansPlanned: 0, scansAdmitted: 0 } },
          reconciliation: { reconciled: true, mismatches: [] },
        },
      },
      controls: {
        publicVisibilityEnabled: false,
        installabilityEnabled: false,
        claimExecutionEnabled: false,
        publisherAttachmentEnabled: false,
        schedulesEnabled: false,
        scanAdmissionEnabled: false,
      },
    });
    expect(getVercelOidcTokenMock).not.toHaveBeenCalled();
    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  it("fails closed when the controlled canary rerun is not idempotent", async () => {
    readBodyMock.mockResolvedValue({
      mode: "controlled-canary",
      reason: "CLAW-557 hidden metadata canary",
    });
    vi.stubGlobal(
      "fetch",
      controlledCanaryFetch({
        observed: 1,
        inserted: 0,
        updated: 1,
        unchanged: 0,
        scansPlanned: 1,
        scansAdmitted: 0,
      }),
    );

    const handler = (await import("./routes/ops/skills-sh/catalog-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "skills_sh_catalog_test_failed",
      message: "Convex Test controlled canary identical rerun was not idempotent",
    });
  });

  it.each([
    { body: [], label: "array body" },
    { body: { allowlist: {} }, label: "non-array allowlist" },
    { body: { allowlist: [null] }, label: "non-string allowlist member" },
    { body: { reason: 42 }, label: "non-string reason" },
  ])("rejects a malformed $label before calling any backend", async ({ body }) => {
    readBodyMock.mockResolvedValue(body);
    const handler = (await import("./routes/ops/skills-sh/catalog-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request_body" });
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
              provenance: "stored-authenticated-staging-live",
              fetches: 0,
              reused: 2,
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

  it.each([
    { status: "running", cursor: 500 },
    { status: "completed", cursor: 499 },
  ])("fails closed when a snapshot run ends at $status with cursor $cursor", async (terminal) => {
    const baseFetch = vi.mocked(fetch);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = init.body ? (JSON.parse(String(init.body)) as { operation?: string }) : null;
        if (body?.operation === "batch") {
          return new Response(JSON.stringify(terminal));
        }
        return await baseFetch(url, init);
      }),
    );

    const handler = (await import("./routes/ops/skills-sh/catalog-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "skills_sh_catalog_test_failed",
      message: expect.stringContaining("did not complete all 500 rows"),
    });
  });

  it("fails closed when any allowlisted real scan is skipped", async () => {
    const baseFetch = vi.mocked(fetch);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = init.body ? (JSON.parse(String(init.body)) as { operation?: string }) : null;
        if (body?.operation === "admit") {
          return new Response(JSON.stringify({ requested: 1, admitted: 0, skipped: 1 }));
        }
        return await baseFetch(url, init);
      }),
    );

    const handler = (await import("./routes/ops/skills-sh/catalog-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "skills_sh_catalog_test_failed",
      message: expect.stringContaining("did not admit the complete allowlist"),
    });
  });

  it("uses the normalized deduplicated allowlist for capture, admission, and accounting", async () => {
    readBodyMock.mockResolvedValue({
      allowlist: [
        " NVIDIA/SKILLS/AIQ-DEPLOY ",
        "",
        "nvidia/skills/aiq-deploy",
        " nvidia/skills/aiq-deploy ",
      ],
    });
    const handler = (await import("./routes/ops/skills-sh/catalog-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(captureSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        admitExternalIds: ["nvidia/skills/aiq-deploy"],
      }),
    );
    const admitCall = vi.mocked(fetch).mock.calls.find(([, init]) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return body?.operation === "admit";
    });
    expect(JSON.parse(String(admitCall?.[1]?.body))).toMatchObject({
      externalIds: ["nvidia/skills/aiq-deploy"],
    });
    expect(await response.json()).toMatchObject({
      convex: { admission: { requested: 1, admitted: 1, skipped: 0 } },
    });
  });
});
