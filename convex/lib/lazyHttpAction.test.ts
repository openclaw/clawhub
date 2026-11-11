/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../_generated/server";
import { getRegisteredHttpHandler } from "./httpRouteRateLimit";
import { lazyHttpAction } from "./lazyHttpAction";

describe("lazy HTTP actions", () => {
  it("does not load a route until invoked and preserves context, request and response", async () => {
    const response = new Response("ready", { status: 201, headers: { "X-Test": "kept" } });
    const handler = vi.fn(async () => response);
    const load = vi.fn(async () => httpAction(handler));
    const action = lazyHttpAction(load);
    expect(load).not.toHaveBeenCalled();
    const ctx = {} as ActionCtx;
    const request = new Request("https://example.invalid/api/v1/example", {
      method: "POST",
      body: "unchanged",
    });
    expect(await getRegisteredHttpHandler(action)(ctx, request)).toBe(response);
    expect(handler).toHaveBeenCalledExactlyOnceWith(ctx, request);
    expect(await request.text()).toBe("unchanged");
  });

  it("propagates a load failure without poisoning the next request", async () => {
    const error = new Error("module unavailable");
    const load = vi
      .fn<() => Promise<ReturnType<typeof httpAction>>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(httpAction(async () => new Response("recovered")));
    const action = lazyHttpAction(load);
    const ctx = {} as ActionCtx;
    const request = new Request("https://example.invalid/api/v1/example");
    await expect(getRegisteredHttpHandler(action)(ctx, request)).rejects.toBe(error);
    expect(await (await getRegisteredHttpHandler(action)(ctx, request)).text()).toBe("recovered");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("preserves handler failures instead of turning them into successful data", async () => {
    const error = new Error("quota or upstream failure");
    const action = lazyHttpAction(async () =>
      httpAction(async () => {
        throw error;
      }),
    );
    await expect(
      getRegisteredHttpHandler(action)(
        {} as ActionCtx,
        new Request("https://example.invalid/api/v1/example"),
      ),
    ).rejects.toBe(error);
  });
});
