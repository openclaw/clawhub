/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { getRegisteredHttpHandler } from "./lib/httpRouteRateLimit";
const { fast, catalog, legacy } = vi.hoisted(() => ({
  fast: vi.fn(),
  catalog: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock("./lib/templateCategoryListHttpRead", () => ({ readTemplateCatalogHttp: catalog }));
vi.mock("./lib/templatePackageHttpRead", () => ({ readTemplatePackageHttp: fast }));
vi.mock("./httpApiV1/packagesV1", () => ({ packagesGetRouterV1Handler: legacy }));
import { get } from "./packageReadHttp";
const handler = getRegisteredHttpHandler(get);
const ctx = {} as ActionCtx;
const request = () => new Request("https://example.invalid/api/v1/packages/@maker/brief");
beforeEach(() => {
  fast.mockReset();
  catalog.mockReset();
  legacy.mockReset();
});
describe("package read dispatch", () => {
  it("serves an ordinary Template search without a detail read or compatibility fallback", async () => {
    const response = new Response("ranked");
    const req = new Request(
      "https://example.invalid/api/v1/packages/search?family=template&q=brief",
    );
    catalog.mockResolvedValue(response);
    expect(await handler(ctx, req)).toBe(response);
    expect(catalog).toHaveBeenCalledExactlyOnceWith(ctx, req);
    expect(fast).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("returns the narrow response without invoking compatibility code", async () => {
    const response = new Response("narrow");
    fast.mockResolvedValue(response);
    const req = request();
    expect(await handler(ctx, req)).toBe(response);
    expect(fast).toHaveBeenCalledExactlyOnceWith(ctx, req);
    expect(legacy).not.toHaveBeenCalled();
  });
  it("preserves context and Request identity on compatibility fallback", async () => {
    const response = new Response("legacy");
    fast.mockResolvedValue(null);
    legacy.mockResolvedValue(response);
    const req = request();
    expect(await handler(ctx, req)).toBe(response);
    expect(legacy).toHaveBeenCalledExactlyOnceWith(ctx, req);
  });
  it("does not turn a failed narrow read into a compatibility retry", async () => {
    const error = new Error("upstream failure");
    fast.mockRejectedValue(error);
    await expect(handler(ctx, request())).rejects.toBe(error);
    expect(legacy).not.toHaveBeenCalled();
  });
});
