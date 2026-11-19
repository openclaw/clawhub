/* @vitest-environment node */
import { getFunctionName, type FunctionReference } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
const { rate, token } = vi.hoisted(() => ({ rate: vi.fn(), token: vi.fn() }));
vi.mock("./httpRateLimit", () => ({ applyRateLimit: rate }));
vi.mock("./apiTokenAuth", () => ({
  getOptionalApiTokenUserId: token,
  requireApiTokenUser: vi.fn(),
}));
vi.mock("./access", () => ({ getOptionalActiveAuthUserIdFromAction: vi.fn(async () => null) }));
import { listPackagesV1Handler, packagesGetRouterV1Handler } from "../httpApiV1/packagesV1";
import { readTemplateCatalogHttp } from "./templateCategoryListHttpRead";

const item = { name: "@maker/brief", family: "template", categories: ["travel"] };
function fixture(page: { isDone?: boolean; continueCursor?: string } = {}) {
  const runQuery = vi.fn(async (ref: unknown, _args: Record<string, unknown>) => {
    const name = getFunctionName(ref as FunctionReference<"query">);
    if (name.endsWith("searchForViewerInternal")) return [{ score: 4, rankTier: 3, package: item }];
    if (name.endsWith("listPageForViewerInternal"))
      return {
        page: [item],
        isDone: page.isDone ?? true,
        continueCursor: page.continueCursor ?? "",
      };
    throw new Error("Unexpected query: " + name);
  });
  const getUserIdentity = vi.fn(async (): Promise<unknown> => null);
  const ctx = { runQuery, auth: { getUserIdentity } } as unknown as ActionCtx;
  return { ctx, runQuery, getUserIdentity };
}
const req = (search: string, init?: RequestInit) =>
  new Request("https://example.invalid/api/v1/packages?" + search, init);
/** Convex drops undefined arguments, so only defined ones identify the read. */
const defined = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
beforeEach(() => {
  rate.mockReset().mockResolvedValue({ ok: true, headers: { "X-Test-Rate": "kept" } });
  token.mockReset().mockResolvedValue(null);
});

describe("Template catalog HTTP reads", () => {
  it.each([
    "q=%20brief%20&limit=20",
    "q=brief&category=travel",
    "q=brief&limit=500",
    "q=brief&limit=bad",
  ])(
    "avoids the compatibility router for a ranked search with the same public contract: %s",
    async (filters) => {
      const searchRequest = new Request(
        "https://example.invalid/api/v1/packages/search?family=template&" + filters,
      );
      const narrow = fixture();
      const router = fixture();
      const response = await readTemplateCatalogHttp(narrow.ctx, searchRequest);
      const expected = await packagesGetRouterV1Handler(router.ctx, searchRequest);
      expect(response?.status).toBe(200);
      expect(narrow.runQuery).toHaveBeenCalledTimes(1);
      expect(getFunctionName(narrow.runQuery.mock.calls[0]![0] as FunctionReference<"query">)).toBe(
        "packages:searchForViewerInternal",
      );
      expect(defined(narrow.runQuery.mock.calls[0]![1])).toEqual(
        defined(router.runQuery.mock.calls[0]![1]),
      );
      expect(await response?.json()).toEqual(await expected.json());
      expect(Object.fromEntries(response!.headers)).toEqual(Object.fromEntries(expected.headers));
    },
  );

  it.each(["q=", "q=a&cursor=next", "q=a&q=b", "q=a&isOfficial=false", "q=a&category=marketing"])(
    "leaves unsupported or invalid searches to the existing router: %s",
    async (filters) => {
      const f = fixture();
      expect(
        await readTemplateCatalogHttp(
          f.ctx,
          new Request("https://example.invalid/api/v1/packages/search?family=template&" + filters),
        ),
      ).toBeNull();
      expect(rate).not.toHaveBeenCalled();
      expect(f.runQuery).not.toHaveBeenCalled();
    },
  );

  it("returns the category page and preserves response policy", async () => {
    const f = fixture();
    const response = await readTemplateCatalogHttp(
      f.ctx,
      req("family=template&category=travel&limit=100"),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(response?.headers.get("X-Test-Rate")).toBe("kept");
    expect(await response?.json()).toEqual({ items: [item], nextCursor: null });
    expect(f.runQuery).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      family: "template",
      category: "travel",
      viewerUserId: undefined,
      paginationOpts: { cursor: null, numItems: 100 },
    });
  });

  it("continues a category with the cursor the previous page returned", async () => {
    const f = fixture({ isDone: false, continueCursor: "next-page" });
    const response = await readTemplateCatalogHttp(
      f.ctx,
      req("family=template&category=other&cursor=this-page"),
    );
    expect(await response?.json()).toEqual({ items: [item], nextCursor: "next-page" });
    expect(f.runQuery.mock.calls[0]?.[1]).toMatchObject({
      category: "other",
      paginationOpts: { cursor: "this-page", numItems: 25 },
    });
  });

  it.each([
    "family=template&category=travel",
    "family=template",
    "family=template&limit=20",
    "family=template&limit=20&cursor=page-two",
    "family=template&category=travel&limit=100",
    "family=template&category=travel&limit=0",
    "family=template&category=travel&limit=999",
    "family=template&category=travel&limit=abc",
    "family=template&category=%20travel%20&limit=8",
    "family=template&category=other&limit=8&cursor=page-two",
    "family=template&category=travel&cursor=",
    "family=template&category=household&limit=8",
    "family=template&category=entertainment&limit=8",
    // Removed from the taxonomy, but still stored by unrewritten listings and still
    // requested by released OpenClaw clients.
    "family=template&category=personal&limit=8",
    "family=template&category=governance&limit=8",
    "family=template&category=finance&limit=8",
    "family=template&category=people&limit=8",
  ])("reads the catalog router's own query for %s", async (search) => {
    const narrow = fixture();
    const router = fixture();
    const narrowResponse = await readTemplateCatalogHttp(narrow.ctx, req(search));
    const routerResponse = await listPackagesV1Handler(router.ctx, req(search));
    expect(narrow.runQuery).toHaveBeenCalledTimes(1);
    expect(router.runQuery).toHaveBeenCalledTimes(1);
    expect(getFunctionName(narrow.runQuery.mock.calls[0]![0] as FunctionReference<"query">)).toBe(
      getFunctionName(router.runQuery.mock.calls[0]![0] as FunctionReference<"query">),
    );
    expect(defined(narrow.runQuery.mock.calls[0]![1])).toEqual(
      defined(router.runQuery.mock.calls[0]![1]),
    );
    expect(await narrowResponse?.json()).toEqual(await routerResponse.json());
    expect(Object.fromEntries(narrowResponse!.headers)).toEqual(
      Object.fromEntries(routerResponse.headers),
    );
  });

  it("reads as the API-token user exactly as the router does", async () => {
    token.mockResolvedValue("actor");
    const bearer = { headers: { authorization: "Bearer current-token" } };
    const search = "family=template&category=travel&limit=100";
    const narrow = fixture();
    const router = fixture();
    await readTemplateCatalogHttp(narrow.ctx, req(search, bearer));
    await listPackagesV1Handler(router.ctx, req(search, bearer));
    expect(narrow.runQuery.mock.calls[0]?.[1]).toMatchObject({ viewerUserId: "actor" });
    expect(defined(narrow.runQuery.mock.calls[0]![1])).toEqual(
      defined(router.runQuery.mock.calls[0]![1]),
    );
    // Session identity is never consulted once a token names the reader.
    expect(narrow.getUserIdentity).not.toHaveBeenCalled();
  });

  it.each([
    "family=template&category=",
    "family=template&category=marketing",
    "category=travel",
    "family=code-plugin&category=travel",
    "family=%20template&category=travel",
    "family=template&category=travel&sort=downloads",
    "family=template&category=travel&featured=true",
    "family=template&category=travel&channel=official",
    "family=template&category=travel&isOfficial=true",
    "family=template&category=travel&topic=flights",
    "family=template&category=travel&q=flights",
    "family=template&category=travel&category=health",
    "family=template&family=skill&category=travel",
  ])("leaves %s to the catalog router", async (search) => {
    const f = fixture();
    expect(await readTemplateCatalogHttp(f.ctx, req(search))).toBeNull();
    expect(rate).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(f.runQuery).not.toHaveBeenCalled();
  });

  it("leaves a slug that was never a Template category to the router's validation error", async () => {
    const f = fixture();
    const search = "family=template&category=marketing";
    expect(await readTemplateCatalogHttp(f.ctx, req(search))).toBeNull();
    const response = await listPackagesV1Handler(f.ctx, req(search));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid Template category");
    expect(f.runQuery).not.toHaveBeenCalled();
  });

  it("leaves cookie-backed, unresolved and failing credentials to the catalog router", async () => {
    const f = fixture();
    const search = "family=template&category=travel";
    expect(
      await readTemplateCatalogHttp(f.ctx, req(search, { headers: { cookie: "s=1" } })),
    ).toBeNull();
    expect(token).not.toHaveBeenCalled();
    const bearer = { headers: { authorization: "Bearer not-a-current-token" } };
    token.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("auth failed"));
    expect(await readTemplateCatalogHttp(f.ctx, req(search, bearer))).toBeNull();
    expect(await readTemplateCatalogHttp(f.ctx, req(search, bearer))).toBeNull();
    expect(f.getUserIdentity).not.toHaveBeenCalled();
    f.getUserIdentity.mockResolvedValue({ subject: "actor" });
    expect(await readTemplateCatalogHttp(f.ctx, req(search))).toBeNull();
    expect(rate).not.toHaveBeenCalled();
    expect(f.runQuery).not.toHaveBeenCalled();
  });

  it("returns a rate-limit denial without reading the catalog", async () => {
    const f = fixture();
    const denied = new Response("Rate limit exceeded", { status: 429 });
    rate.mockResolvedValue({ ok: false, response: denied });
    const request = req("family=template&category=travel");
    expect(await readTemplateCatalogHttp(f.ctx, request)).toBe(denied);
    expect(rate).toHaveBeenCalledExactlyOnceWith(f.ctx, request, "read");
    expect(f.runQuery).not.toHaveBeenCalled();
  });
});
