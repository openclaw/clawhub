/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getHeaderMock = vi.fn();
const getVercelOidcTokenMock = vi.fn();
const readBodyMock = vi.fn();
const fetchPageMock = vi.fn();
const fetchBatchMock = vi.fn();
const fetchControlledBatchMock = vi.fn();
const measureProofSourceMock = vi.fn();
const buildProofSnapshotIdMock = vi.fn();
const parseProofSnapshotIdMock = vi.fn();
const sourcePolicyMock = vi.fn();
const sourceRetryAfterMock = vi.fn();
const enrichClassificationsMock = vi.fn();
const buildReplayRowsMock = vi.fn();

function capturedSourcePage(
  page = 3,
  pageLength = 500,
  hasMore = true,
  identityHash = `page-${page}`,
) {
  return {
    page,
    sourceTotal: 9_571,
    pageLength,
    hasMore,
    identityHash,
    contentHash: `content-${page}`,
    rows: [
      {
        id: "vercel-labs/skills/find-skills",
        installUrl: "https://github.com/vercel-labs/skills",
        installs: 42,
        name: "Find Skills",
        slug: "find-skills",
        source: "vercel-labs/skills",
        sourceType: "github",
        url: "https://skills.sh/vercel-labs/skills/find-skills",
      },
    ],
  };
}

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
  fetchSkillsShCatalogPage: (...args: unknown[]) => fetchPageMock(...args),
  fetchSkillsShMirrorBatch: (...args: unknown[]) => fetchBatchMock(...args),
  fetchSkillsShMirrorControlledBatch: (...args: unknown[]) => fetchControlledBatchMock(...args),
  getSkillsShCatalogTestSourcePolicy: (...args: unknown[]) => sourcePolicyMock(...args),
  measureSkillsShMirrorProofSource: (...args: unknown[]) => measureProofSourceMock(...args),
  parseSkillsShMirrorProofSnapshotId: (...args: unknown[]) => parseProofSnapshotIdMock(...args),
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
    fetchControlledBatchMock.mockReset();
    measureProofSourceMock.mockReset();
    buildProofSnapshotIdMock.mockReset();
    parseProofSnapshotIdMock.mockReset();
    sourcePolicyMock.mockReset();
    sourceRetryAfterMock.mockReset();
    enrichClassificationsMock.mockReset();
    enrichClassificationsMock.mockImplementation((rows) => rows);
    buildReplayRowsMock.mockReset();
    sourceRetryAfterMock.mockReturnValue(null);
    sourcePolicyMock.mockReturnValue({ allowed: true, environment: "test" });
    getHeaderMock.mockReturnValue("Bearer operator-token");
    getVercelOidcTokenMock.mockResolvedValue("request-oidc-token");
    buildProofSnapshotIdMock.mockReturnValue("skills-sh:proof:snapshot");
    parseProofSnapshotIdMock.mockReturnValue({
      catalogTotal: 9_571,
      controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledOverlayExternalIds: [],
      controlledSupplementExternalIds: [
        "patrick-erichsen/skills/html",
        "steipete/clawdis/discrawl",
      ],
      sourceSnapshotHash: "a".repeat(64),
      evidence: {
        pagination: {
          requestedPages: [
            {
              page: 3,
              count: 500,
              hasMore: true,
              identityHash: "page-3",
              contentHash: "content-3",
            },
            {
              page: 19,
              count: 71,
              hasMore: false,
              identityHash: "page-19",
              contentHash: "content-19",
            },
          ],
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts from a freshly measured authenticated source total", async () => {
    readBodyMock.mockResolvedValue({ operation: "start", reason: "CLAW-563 proof" });
    measureProofSourceMock.mockResolvedValue({
      catalogTotal: 9_571,
      controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledOverlayExternalIds: ["patrick-erichsen/skills/html"],
      controlledSupplementExternalIds: ["steipete/clawdis/discrawl"],
      pageSize: 500,
      sourceRequests: 20,
      sourcePages: [
        {
          ...capturedSourcePage(0, 500, true, "page-0"),
          sourceBytes: 10_000,
          serializedBytes: 10_200,
        },
      ],
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-source-page-store") {
        return new Response(JSON.stringify({ stored: true, page: body.page, rows: 500 }));
      }
      if (body.operation === "mirror-source-summary") {
        return new Response(
          JSON.stringify({
            snapshotHash: "a".repeat(64),
            pageDocuments: 1,
            rows: 500,
            sourceBytes: 10_000,
            serializedBytes: 10_200,
          }),
        );
      }
      if (body.operation === "mirror-run") {
        return new Response(JSON.stringify({ status: "running", page: 3, offset: 50 }));
      }
      expect(body).toMatchObject({
        operation: "mirror-start",
        snapshotId: "skills-sh:proof:snapshot",
        sourceSnapshotHash: "a".repeat(64),
        sourceCaptureWrites: 1,
        sourceTotal: 9_572,
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
      sourceTotal: 9_572,
      sourceCatalogTotal: 9_571,
      controlledOverlayTotal: 1,
      controlledSupplementTotal: 1,
      sourceMeasurementRequests: 20,
      sourceCapture: {
        snapshotHash: "a".repeat(64),
        pageDocuments: 1,
        rows: 500,
        sourceBytes: 10_000,
        serializedBytes: 10_200,
        requestDbWrites: 1,
      },
    });
    expect(measureProofSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ oidcToken: "request-oidc-token" }),
    );
  });

  it("records zero capture writes when immutable source pages are reused", async () => {
    readBodyMock.mockResolvedValue({ operation: "start", reason: "CLAW-563 recovered proof" });
    measureProofSourceMock.mockResolvedValue({
      catalogTotal: 9_571,
      controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledOverlayExternalIds: [],
      controlledSupplementExternalIds: [
        "patrick-erichsen/skills/html",
        "steipete/clawdis/discrawl",
      ],
      pageSize: 500,
      sourceRequests: 20,
      sourcePages: [
        {
          ...capturedSourcePage(0, 500, true, "page-0"),
          sourceBytes: 10_000,
          serializedBytes: 10_200,
        },
      ],
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-source-page-store") {
        return new Response(JSON.stringify({ stored: false, page: body.page, rows: 500 }));
      }
      if (body.operation === "mirror-source-summary") {
        return new Response(
          JSON.stringify({
            snapshotHash: "a".repeat(64),
            pageDocuments: 1,
            rows: 500,
            sourceBytes: 10_000,
            serializedBytes: 10_200,
          }),
        );
      }
      expect(body).toMatchObject({
        operation: "mirror-start",
        sourceCaptureWrites: 0,
      });
      return new Response(
        JSON.stringify({
          runId: "skillsShMirrorRuns:recovered",
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
      runId: "skillsShMirrorRuns:recovered",
      sourceCapture: {
        pageDocuments: 1,
        requestDbWrites: 0,
      },
    });
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

  it("reads one exact mirror run for durable recovery", async () => {
    readBodyMock.mockResolvedValue({
      operation: "run",
      runId: "skillsShMirrorRuns:live",
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        operation: "mirror-run",
        runId: "skillsShMirrorRuns:live",
      });
      return new Response(
        JSON.stringify({
          runId: "skillsShMirrorRuns:live",
          snapshotId: "skills-sh:2026-07-22T21:18:13.365Z:9571",
          status: "completed",
        }),
      );
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runId: "skillsShMirrorRuns:live",
      status: "completed",
    });
  });

  it("discards one stale captured recovery before a fresh authenticated run", async () => {
    readBodyMock.mockResolvedValue({
      operation: "discard",
      runId: "skillsShMirrorRuns:stale",
      reason: "discard stale captured recovery",
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        operation: "mirror-cancel",
        runId: "skillsShMirrorRuns:stale",
        reason: "discard stale captured recovery",
        confirm: "cancel-skills-sh-mirror-test-run",
      });
      return new Response(
        JSON.stringify({
          runId: "skillsShMirrorRuns:stale",
          status: "canceled",
        }),
      );
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runId: "skillsShMirrorRuns:stale",
      status: "canceled",
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
      sourcePageIdentityHash: "page-3",
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
        return new Response(
          JSON.stringify({
            ...body,
            snapshotId: "skills-sh:proof:snapshot",
            sourcePageSize: 500,
            sourceTotal: 9_573,
            sourcePage: capturedSourcePage(),
          }),
        );
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

  it("replaces a live controlled row with its pinned Test observation", async () => {
    parseProofSnapshotIdMock.mockReturnValue({
      catalogTotal: 9_571,
      controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledOverlayExternalIds: ["patrick-erichsen/skills/html"],
      controlledSupplementExternalIds: ["steipete/clawdis/discrawl"],
      evidence: {
        pagination: {
          requestedPages: [
            {
              page: 3,
              count: 500,
              hasMore: true,
              identityHash: "page-3",
              contentHash: "content-3",
            },
          ],
        },
      },
    });
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
      sourceRequests: 5,
      sourceBytes: 5_000,
      sourcePageIdentityHash: "page-3",
      rows: [
        { externalId: "patrick-erichsen/skills/html", sourceContentHash: "mutable" },
        { externalId: "vercel-labs/skills/find-skills" },
      ],
    });
    fetchControlledBatchMock.mockResolvedValue({
      page: 3,
      offset: 50,
      pageLength: 1,
      sourceTotal: 9_572,
      hasMore: false,
      sourceRequests: 1,
      sourceBytes: 1_000,
      rows: [
        {
          externalId: "patrick-erichsen/skills/html",
          sourceContentHash: "pinned",
        },
      ],
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim") {
        return new Response(
          JSON.stringify({
            ...body,
            snapshotId: "skills-sh:proof:snapshot",
            sourcePageSize: 500,
            sourceTotal: 9_572,
            sourcePage: capturedSourcePage(),
          }),
        );
      }
      if (body.operation === "mirror-classification-states") {
        expect(body.externalIds).toEqual([
          "patrick-erichsen/skills/html",
          "vercel-labs/skills/find-skills",
        ]);
        return new Response(JSON.stringify({ states: [] }));
      }
      expect(body).toMatchObject({
        operation: "mirror-batch",
        sourceTotal: 9_572,
        sourceRequests: 6,
        sourceBytes: 6_000,
        rows: [
          {
            externalId: "patrick-erichsen/skills/html",
            sourceContentHash: "pinned",
          },
          { externalId: "vercel-labs/skills/find-skills" },
        ],
      });
      return new Response(JSON.stringify({ status: "running", page: 3, offset: 100 }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(fetchControlledBatchMock).toHaveBeenCalledWith(
      {
        page: 3,
        offset: 0,
        limit: 1,
        maxDetailBytes: 65_536,
        sourceTotal: 9_572,
        externalIds: ["patrick-erichsen/skills/html"],
      },
      expect.objectContaining({ beforeRequest: expect.any(Function) }),
    );
  });

  it("releases the claimed batch lease when snapshot validation fails", async () => {
    parseProofSnapshotIdMock.mockImplementation(() => {
      throw new Error("invalid proof snapshot");
    });
    readBodyMock.mockResolvedValue({
      operation: "step",
      runId: "skillsShMirrorRuns:test",
      page: 3,
      offset: 50,
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim") {
        return new Response(
          JSON.stringify({
            ...body,
            snapshotId: "invalid",
            sourcePageSize: 500,
            sourceTotal: 9_572,
          }),
        );
      }
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

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("invalid proof snapshot"),
    });
    expect(convexFetch).toHaveBeenCalledTimes(2);
    expect(fetchBatchMock).not.toHaveBeenCalled();
  });

  it("renews the durable lease during a long source batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T20:00:00.000Z"));
    readBodyMock.mockResolvedValue({
      operation: "step",
      runId: "skillsShMirrorRuns:test",
      page: 3,
      offset: 50,
      sourceTotal: 9_573,
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
        sourcePageIdentityHash: "page-3",
        rows: [{ externalId: "vercel-labs/skills/find-skills" }],
      };
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim") {
        return new Response(
          JSON.stringify({
            ...body,
            snapshotId: "skills-sh:proof:snapshot",
            sourcePageSize: 500,
            sourceTotal: 9_573,
            sourcePage: capturedSourcePage(),
          }),
        );
      }
      if (body.operation === "mirror-batch-release") {
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

  it("releases the lease when the ordered leaderboard page changed", async () => {
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
      sourceRequests: 5,
      sourceBytes: 5_000,
      sourcePageIdentityHash: "changed-page-3",
      rows: [{ externalId: "vercel-labs/skills/find-skills" }],
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim") {
        return new Response(
          JSON.stringify({
            ...body,
            snapshotId: "skills-sh:proof:snapshot",
            sourcePageSize: 500,
            sourceTotal: 9_573,
            sourcePage: capturedSourcePage(),
          }),
        );
      }
      expect(body.operation).toBe("mirror-batch-release");
      return new Response(JSON.stringify({ released: true }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("ordered leaderboard page changed"),
    });
    expect(convexFetch).toHaveBeenCalledTimes(2);
  });

  it("releases the lease when the measured leaderboard pagination state changed", async () => {
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
      hasMore: false,
      sourceRequests: 5,
      sourceBytes: 5_000,
      sourcePageIdentityHash: "page-3",
      rows: [{ externalId: "vercel-labs/skills/find-skills" }],
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim") {
        return new Response(
          JSON.stringify({
            ...body,
            snapshotId: "skills-sh:proof:snapshot",
            sourcePageSize: 500,
            sourceTotal: 9_573,
            sourcePage: capturedSourcePage(),
          }),
        );
      }
      expect(body.operation).toBe("mirror-batch-release");
      return new Response(JSON.stringify({ released: true }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("ordered leaderboard page changed"),
    });
    expect(convexFetch).toHaveBeenCalledTimes(2);
  });

  it("returns a retryable response without advancing the durable cursor on source rate limits", async () => {
    readBodyMock.mockResolvedValue({
      operation: "step",
      runId: "skillsShMirrorRuns:test",
      page: 3,
      offset: 50,
      sourceTotal: 9_573,
    });
    fetchBatchMock.mockRejectedValue(new Error("source rate limited"));
    sourceRetryAfterMock.mockReturnValue(17);
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim") {
        return new Response(
          JSON.stringify({
            ...body,
            snapshotId: "skills-sh:proof:snapshot",
            sourcePageSize: 500,
            sourceTotal: 9_573,
            sourcePage: capturedSourcePage(),
          }),
        );
      }
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

  it("appends the bounded controlled GitHub proof page after the authenticated catalog", async () => {
    readBodyMock.mockResolvedValue({
      operation: "step",
      runId: "skillsShMirrorRuns:test",
      page: 20,
      offset: 0,
    });
    fetchControlledBatchMock.mockResolvedValue({
      page: 20,
      offset: 0,
      pageLength: 2,
      sourceTotal: 9_573,
      hasMore: false,
      sourceRequests: 2,
      sourceBytes: 11_085,
      rows: [
        { externalId: "patrick-erichsen/skills/html" },
        { externalId: "steipete/clawdis/discrawl" },
      ],
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim") {
        return new Response(
          JSON.stringify({
            ...body,
            snapshotId: "skills-sh:proof:snapshot",
            sourcePageSize: 500,
            sourceTotal: 9_573,
          }),
        );
      }
      if (body.operation === "mirror-classification-states") {
        expect(body.externalIds).toEqual([
          "patrick-erichsen/skills/html",
          "steipete/clawdis/discrawl",
        ]);
        return new Response(JSON.stringify({ states: [] }));
      }
      expect(body).toMatchObject({
        operation: "mirror-batch",
        page: 20,
        offset: 0,
        pageLength: 2,
        sourceTotal: 9_573,
        hasMore: false,
      });
      return new Response(JSON.stringify({ status: "reconciling", page: 21, offset: 0 }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "reconciling" });
    expect(fetchControlledBatchMock).toHaveBeenCalledWith(
      {
        page: 20,
        offset: 0,
        limit: 50,
        maxDetailBytes: 65_536,
        sourceTotal: 9_573,
        externalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      },
      expect.objectContaining({ beforeRequest: expect.any(Function) }),
    );
    expect(fetchBatchMock).not.toHaveBeenCalled();
    expect(getVercelOidcTokenMock).not.toHaveBeenCalled();
  });

  it("completes on the leaderboard page when every controlled identity is already present", async () => {
    parseProofSnapshotIdMock.mockReturnValue({
      catalogTotal: 9_571,
      controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledOverlayExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
      controlledSupplementExternalIds: [],
      evidence: {
        pagination: {
          requestedPages: [
            {
              page: 19,
              count: 71,
              hasMore: false,
              identityHash: "page-19",
              contentHash: "content-19",
            },
          ],
        },
      },
    });
    readBodyMock.mockResolvedValue({
      operation: "step",
      runId: "skillsShMirrorRuns:test",
      page: 19,
      offset: 70,
    });
    fetchBatchMock.mockResolvedValue({
      page: 19,
      offset: 70,
      pageLength: 71,
      sourceTotal: 9_571,
      hasMore: false,
      sourceRequests: 3,
      sourceBytes: 1_024,
      sourcePageIdentityHash: "page-19",
      rows: [{ externalId: "owner/repo/final" }],
    });
    const convexFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.operation === "mirror-batch-claim") {
        return new Response(
          JSON.stringify({
            ...body,
            snapshotId: "skills-sh:proof:snapshot",
            sourcePageSize: 500,
            sourceTotal: 9_571,
            sourcePage: capturedSourcePage(19, 71, false, "page-19"),
          }),
        );
      }
      if (body.operation === "mirror-classification-states") {
        return new Response(JSON.stringify({ states: [] }));
      }
      expect(body).toMatchObject({
        operation: "mirror-batch",
        page: 19,
        offset: 70,
        sourceTotal: 9_571,
        hasMore: false,
      });
      return new Response(JSON.stringify({ status: "reconciling", page: 20, offset: 0 }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "reconciling" });
    expect(fetchControlledBatchMock).not.toHaveBeenCalled();
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
