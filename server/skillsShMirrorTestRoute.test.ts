/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getHeaderMock = vi.fn();
const getVercelOidcTokenMock = vi.fn();
const readBodyMock = vi.fn();
const fetchPageMock = vi.fn();
const fetchBatchMock = vi.fn();
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
  fetchSkillsShCatalogPage: (...args: unknown[]) => fetchPageMock(...args),
  fetchSkillsShMirrorBatch: (...args: unknown[]) => fetchBatchMock(...args),
  getSkillsShCatalogTestSourcePolicy: (...args: unknown[]) => sourcePolicyMock(...args),
}));

describe("skills.sh permanent Test mirror route", () => {
  beforeEach(() => {
    getHeaderMock.mockReset();
    getVercelOidcTokenMock.mockReset();
    readBodyMock.mockReset();
    fetchPageMock.mockReset();
    fetchBatchMock.mockReset();
    sourcePolicyMock.mockReset();
    sourcePolicyMock.mockReturnValue({ allowed: true, environment: "test" });
    getHeaderMock.mockReturnValue("Bearer operator-token");
    getVercelOidcTokenMock.mockResolvedValue("request-oidc-token");
  });

  afterEach(() => {
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
      return new Response(JSON.stringify({ runId: "skillsShMirrorRuns:test" }));
    });
    vi.stubGlobal("fetch", convexFetch);

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runId: "skillsShMirrorRuns:test",
      sourceTotal: 9_571,
    });
    expect(fetchPageMock).toHaveBeenCalledWith(
      { page: 0, perPage: 500 },
      expect.objectContaining({ oidcToken: "request-oidc-token" }),
    );
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
      if (body.operation === "mirror-run") {
        expect(body).toEqual({
          operation: "mirror-run",
          runId: "skillsShMirrorRuns:test",
        });
        return new Response(JSON.stringify({ status: "running", page: 3, offset: 50 }));
      }
      expect(body).toMatchObject({
        operation: "mirror-batch",
        runId: "skillsShMirrorRuns:test",
        page: 3,
        offset: 50,
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
    expect(convexFetch).toHaveBeenCalledTimes(2);
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
        expect(body).toEqual({
          operation: "mirror-run",
          runId: "skillsShMirrorRuns:test",
        });
        return new Response(JSON.stringify({ status: "paused", page: 3, offset: 50 }));
      }),
    );

    const handler = (await import("./routes/ops/skills-sh/mirror-test.post")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      message: "skills.sh mirror run is paused",
    });
    expect(getVercelOidcTokenMock).not.toHaveBeenCalled();
    expect(fetchBatchMock).not.toHaveBeenCalled();
  });
});
