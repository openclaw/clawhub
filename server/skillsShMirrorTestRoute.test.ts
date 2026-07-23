/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getHeaderMock = vi.fn();
const getVercelOidcTokenMock = vi.fn();
const readBodyMock = vi.fn();
const fetchPageMock = vi.fn();
const fetchBatchMock = vi.fn();
const sourcePolicyMock = vi.fn();
const sourceRetryAfterMock = vi.fn();
const enrichClassificationsMock = vi.fn();
const buildReplayRowsMock = vi.fn();

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeaderMock(...args),
  readBody: (...args: unknown[]) => readBodyMock(...args),
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: (...args: unknown[]) => getVercelOidcTokenMock(...args),
}));

vi.mock("./skillsShCatalogSource", () => ({
  fetchSkillsShCatalogPage: (...args: unknown[]) => fetchPageMock(...args),
  fetchSkillsShMirrorBatch: (...args: unknown[]) => fetchBatchMock(...args),
  getSkillsShCatalogTestSourcePolicy: (...args: unknown[]) => sourcePolicyMock(...args),
  skillsShSourceRetryAfterSeconds: (...args: unknown[]) => sourceRetryAfterMock(...args),
}));

vi.mock("./skillsShMirrorClassification", () => ({
  buildSkillsShMirrorReplayRows: (...args: unknown[]) => buildReplayRowsMock(...args),
  enrichSkillsShMirrorClassifications: (...args: unknown[]) => enrichClassificationsMock(...args),
}));

describe("skills.sh permanent Test mirror route", () => {
  beforeEach(() => {
    getHeaderMock.mockReset();
    getVercelOidcTokenMock.mockReset();
    readBodyMock.mockReset();
    fetchPageMock.mockReset();
    fetchBatchMock.mockReset();
    sourcePolicyMock.mockReset();
    sourceRetryAfterMock.mockReset();
    enrichClassificationsMock.mockReset();
    enrichClassificationsMock.mockImplementation((rows) => rows);
    buildReplayRowsMock.mockReset();
    sourceRetryAfterMock.mockReturnValue(null);
    sourcePolicyMock.mockReturnValue({ allowed: true, environment: "test" });
    getHeaderMock.mockReturnValue("Bearer operator-token");
    getVercelOidcTokenMock.mockResolvedValue("request-oidc-token");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts from a freshly measured authenticated source total", async () => {
    readBodyMock.mockResolvedValue({ operation: "start", reason: "CLAW-563 proof" });
    fetchPageMock.mockResolvedValue({
      data: Array.from({ length: 500 }),
      pagination: { page: 0, perPage: 500, total: 9_571, hasMore: true },
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-run") {
        return new Response(JSON.stringify({ status: "running", page: 3, offset: 50 }));
      }
      expect(body).toMatchObject({
        operation: "mirror-start",
        sourceTotal: 9_571,
        sourcePageSize: 500,
        reason: "CLAW-563 proof",
      });
      return new Response(
        JSON.stringify({
          runId: "skillsShMirrorRuns:test",
          status: "running",
          page: 0,
          offset: 0,
        }),
      );
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runId: "skillsShMirrorRuns:test",
      status: "running",
      page: 0,
      offset: 0,
      sourceTotal: 9_571,
    });
    expect(fetchPageMock).toHaveBeenCalledWith(
      { page: 0, perPage: 500 },
      expect.objectContaining({ oidcToken: "request-oidc-token" }),
    );
  });

  it("passes through a completed reconciliation run summary", async () => {
    readBodyMock.mockResolvedValue({
      operation: "reconcile",
      runId: "skillsShMirrorRuns:test",
      limit: 250,
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        operation: "mirror-reconcile",
        runId: "skillsShMirrorRuns:test",
        limit: 250,
      });
      return new Response(
        JSON.stringify({
          runId: "skillsShMirrorRuns:test",
          status: "completed",
          page: 20,
          offset: 0,
        }),
      );
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runId: "skillsShMirrorRuns:test",
      status: "completed",
      page: 20,
      offset: 0,
    });
  });

  it("reads bounded conflicts for the requested live run", async () => {
    readBodyMock.mockResolvedValue({
      operation: "conflicts",
      runId: "skillsShMirrorRuns:live",
      limit: 50,
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        operation: "mirror-conflicts",
        runId: "skillsShMirrorRuns:live",
        limit: 50,
      });
      return new Response(
        JSON.stringify({
          conflicts: [
            {
              runId: "skillsShMirrorRuns:live",
              externalId: "larksuite/cli/lark-doc",
              kind: "source-quarantine",
            },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      conflicts: [
        {
          runId: "skillsShMirrorRuns:live",
          externalId: "larksuite/cli/lark-doc",
          kind: "source-quarantine",
        },
      ],
    });
  });

  it("fetches and commits one exact page-offset batch", async () => {
    readBodyMock.mockResolvedValue({
      operation: "step",
      runId: "skillsShMirrorRuns:test",
      page: 3,
      offset: 50,
    });
    fetchBatchMock.mockResolvedValue({
      page: 3,
      offset: 50,
      pageLength: 500,
      sourceTotal: 9_571,
      hasMore: true,
      sourceRequests: 101,
      sourceBytes: 123_456,
      rows: [{ externalId: "vercel-labs/skills/find-skills" }],
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim") {
        expect(body).toMatchObject({
          operation: "mirror-batch-claim",
          runId: "skillsShMirrorRuns:test",
          page: 3,
          offset: 50,
          leaseToken: expect.any(String),
        });
        return new Response(JSON.stringify(body));
      }
      if (body.operation === "mirror-classification-states") {
        expect(body).toEqual({
          operation: "mirror-classification-states",
          externalIds: ["vercel-labs/skills/find-skills"],
        });
        return new Response(JSON.stringify({ states: [] }));
      }
      expect(body).toMatchObject({
        operation: "mirror-batch",
        runId: "skillsShMirrorRuns:test",
        page: 3,
        offset: 50,
        leaseToken: expect.any(String),
        sourceRequests: 101,
      });
      return new Response(JSON.stringify({ status: "running", page: 3, offset: 100 }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "running", page: 3, offset: 100 });
    expect(fetchBatchMock).toHaveBeenCalledWith(
      { page: 3, offset: 50, limit: 50, maxDetailBytes: 65_536 },
      expect.objectContaining({ oidcToken: "request-oidc-token" }),
    );
    expect(convexFetch).toHaveBeenCalledTimes(3);
    const operatorBodies = convexFetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(operatorBodies[0].leaseToken).toBe(operatorBodies[2].leaseToken);
    expect(enrichClassificationsMock).toHaveBeenCalledWith(
      [{ externalId: "vercel-labs/skills/find-skills" }],
      [],
    );
  });

  it("renews the durable lease during a long source batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T20:00:00.000Z"));
    readBodyMock.mockResolvedValue({
      operation: "step",
      runId: "skillsShMirrorRuns:test",
      page: 3,
      offset: 50,
    });
    fetchBatchMock.mockImplementation(async (_args, options) => {
      await options.beforeRequest();
      vi.setSystemTime(new Date("2026-07-22T20:01:01.000Z"));
      await options.beforeRequest();
      return {
        page: 3,
        offset: 50,
        pageLength: 500,
        sourceTotal: 9_571,
        hasMore: true,
        sourceRequests: 101,
        sourceBytes: 123_456,
        rows: [{ externalId: "vercel-labs/skills/find-skills" }],
      };
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim" || body.operation === "mirror-batch-release") {
        return new Response(JSON.stringify(body));
      }
      if (body.operation === "mirror-classification-states") {
        return new Response(JSON.stringify({ states: [] }));
      }
      return new Response(JSON.stringify({ status: "running", page: 3, offset: 100 }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    const claims = convexFetch.mock.calls
      .map(([, init]) => JSON.parse(String(init?.body)))
      .filter((body) => body.operation === "mirror-batch-claim");
    expect(claims).toHaveLength(2);
    expect(claims[1]).toMatchObject({
      runId: claims[0].runId,
      page: claims[0].page,
      offset: claims[0].offset,
      leaseToken: claims[0].leaseToken,
    });
  });

  it("stops a paused run before fetching another source batch", async () => {
    readBodyMock.mockResolvedValue({
      operation: "step",
      runId: "skillsShMirrorRuns:test",
      page: 3,
      offset: 50,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({
          operation: "mirror-batch-claim",
          runId: "skillsShMirrorRuns:test",
          page: 3,
          offset: 50,
          leaseToken: expect.any(String),
        });
        return new Response(JSON.stringify({ error: "skills.sh mirror run is paused" }), {
          status: 400,
        });
      }),
    );

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("paused") });
    expect(getVercelOidcTokenMock).not.toHaveBeenCalled();
    expect(fetchBatchMock).not.toHaveBeenCalled();
  });

  it("returns a retryable response without advancing the durable cursor on source rate limits", async () => {
    readBodyMock.mockResolvedValue({
      operation: "step",
      runId: "skillsShMirrorRuns:test",
      page: 3,
      offset: 50,
    });
    fetchBatchMock.mockRejectedValue(new Error("source rate limited"));
    sourceRetryAfterMock.mockReturnValue(17);
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim") return new Response(JSON.stringify(body));
      expect(body).toMatchObject({
        operation: "mirror-batch-release",
        runId: "skillsShMirrorRuns:test",
        page: 3,
        offset: 50,
        leaseToken: expect.any(String),
      });
      return new Response(JSON.stringify({ released: true }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(await response.json()).toMatchObject({
      error: "skills_sh_source_rate_limited",
      retryAfterSeconds: 17,
    });
    expect(convexFetch).toHaveBeenCalledTimes(2);
    const operatorBodies = convexFetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(operatorBodies[0].leaseToken).toBe(operatorBodies[1].leaseToken);
  });

  it("passes through bounded facet proof pages", async () => {
    readBodyMock.mockResolvedValue({ operation: "facet-page", cursor: null, limit: 500 });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        operation: "mirror-facet-page",
        cursor: null,
        limit: 500,
      });
      return new Response(
        JSON.stringify({
          page: [{ kind: "category", term: "development" }],
          isDone: true,
          continueCursor: "",
        }),
      );
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      page: [{ kind: "category", term: "development" }],
      isDone: true,
    });
  });

  it("starts and steps a lease-guarded captured replay without source auth", async () => {
    readBodyMock
      .mockResolvedValueOnce({
        operation: "start-replay",
        reason: "captured normalization",
        capturedRunId: "skillsShMirrorRuns:live",
        sourceTotal: 1,
        sourcePageSize: 500,
        sourceMeasuredAt: "2026-07-22T20:14:10.881Z",
      })
      .mockResolvedValueOnce({
        operation: "step-replay",
        runId: "skillsShMirrorRuns:replay",
        page: 0,
        offset: 0,
        pageLength: 1,
        hasMore: false,
        sourceTotal: 1,
        externalIds: ["patrick-erichsen/skills/html"],
      });
    buildReplayRowsMock.mockReturnValue([
      {
        externalId: "patrick-erichsen/skills/html",
        inferredCategories: ["other"],
      },
    ]);
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-start") {
        expect(body).toMatchObject({
          snapshotId: "skills-sh-captured:skillsShMirrorRuns:live",
          sourceTotal: 1,
          sourcePageSize: 500,
        });
        return new Response(
          JSON.stringify({
            runId: "skillsShMirrorRuns:replay",
            status: "running",
            page: 0,
            offset: 0,
          }),
        );
      }
      if (body.operation === "mirror-batch-claim") return new Response(JSON.stringify(body));
      if (body.operation === "mirror-replay-rows") {
        expect(body.externalIds).toEqual(["patrick-erichsen/skills/html"]);
        return new Response(JSON.stringify({ rows: [{ digest: {}, detail: null }] }));
      }
      expect(body).toMatchObject({
        operation: "mirror-batch",
        runId: "skillsShMirrorRuns:replay",
        sourceRequests: 0,
        sourceBytes: 0,
        rows: [
          {
            externalId: "patrick-erichsen/skills/html",
            inferredCategories: ["other"],
          },
        ],
      });
      return new Response(JSON.stringify({ status: "reconciling", page: 1, offset: 0 }));
    });
    vi.stubGlobal("fetch", convexFetch);
    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;

    const startResponse = (await handler({} as never)) as Response;
    const stepResponse = (await handler({} as never)) as Response;

    expect(startResponse.status).toBe(200);
    expect(await startResponse.json()).toMatchObject({
      runId: "skillsShMirrorRuns:replay",
      status: "running",
      page: 0,
      offset: 0,
      sourceTotal: 1,
    });
    expect(stepResponse.status).toBe(200);
    expect(await stepResponse.json()).toMatchObject({ status: "reconciling" });
    expect(getVercelOidcTokenMock).not.toHaveBeenCalled();
    expect(buildReplayRowsMock).toHaveBeenCalledWith([{ digest: {}, detail: null }]);
  });
});
