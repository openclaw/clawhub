/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { getRegisteredHttpHandler } from "./lib/httpRouteRateLimit";
const { narrow, router } = vi.hoisted(() => ({ narrow: vi.fn(), router: vi.fn() }));
vi.mock("./lib/templateCategoryListHttpRead", () => ({ readTemplateCatalogHttp: narrow }));
vi.mock("./httpApiV1/packagesV1", () => ({ listPackagesV1Handler: router }));
import { get } from "./packageListHttp";
const handler = getRegisteredHttpHandler(get);
const ctx = {} as ActionCtx;
const request = () =>
  new Request("https://example.invalid/api/v1/packages?family=template&category=travel");
beforeEach(() => {
  narrow.mockReset();
  router.mockReset();
});
describe("package list dispatch", () => {
  it("returns the narrow response without loading the catalog router", async () => {
    const response = new Response("narrow");
    narrow.mockResolvedValue(response);
    const req = request();
    expect(await handler(ctx, req)).toBe(response);
    expect(narrow).toHaveBeenCalledExactlyOnceWith(ctx, req);
    expect(router).not.toHaveBeenCalled();
  });
  it("preserves context and Request identity when the catalog router answers", async () => {
    const response = new Response("router");
    narrow.mockResolvedValue(null);
    router.mockResolvedValue(response);
    const req = request();
    expect(await handler(ctx, req)).toBe(response);
    expect(router).toHaveBeenCalledExactlyOnceWith(ctx, req);
  });
  it("does not turn a failed narrow read into a catalog router retry", async () => {
    const error = new Error("upstream failure");
    narrow.mockRejectedValue(error);
    await expect(handler(ctx, request())).rejects.toBe(error);
    expect(router).not.toHaveBeenCalled();
  });
});
