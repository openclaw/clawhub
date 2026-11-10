/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import { getRegisteredHttpHandler } from "./lib/httpRouteRateLimit";
const { fast, legacy } = vi.hoisted(() => ({ fast: vi.fn(), legacy: vi.fn() }));
vi.mock("./lib/templatePackageHttpRead", () => ({ readTemplatePackageHttp: fast }));
vi.mock("./httpApiV1/packagesV1", () => ({ packagesGetRouterV1Handler: legacy }));
import { get } from "./packageReadHttp";
const handler = getRegisteredHttpHandler(get);
const ctx = {} as ActionCtx;
const request = () => new Request("https://example.invalid/api/v1/packages/@maker/brief");
beforeEach(() => {
  fast.mockReset();
  legacy.mockReset();
});
describe("package read dispatch", () => {
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
