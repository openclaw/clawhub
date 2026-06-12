/* @vitest-environment node */

import { mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handler = (await import("./[...]")).default;

const originalProxyOrigin = process.env.ASK_MOLTY_PROXY_ORIGIN;
const fetchMock = vi.fn(async () => new Response("ok"));

describe("ask-molty proxy route", () => {
  beforeEach(() => {
    process.env.ASK_MOLTY_PROXY_ORIGIN = "https://docs-chat.example.test";
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (originalProxyOrigin === undefined) delete process.env.ASK_MOLTY_PROXY_ORIGIN;
    else process.env.ASK_MOLTY_PROXY_ORIGIN = originalProxyOrigin;
    vi.unstubAllGlobals();
  });

  it("strips ClawHub credentials before forwarding to the docs assistant origin", async () => {
    const event = mockEvent("http://127.0.0.1:3000/ask-molty/api/chat?q=docs", {
      headers: {
        authorization: "Bearer convex-token",
        cookie: "clawhub_session=secret",
        "x-request-id": "request-123",
      },
    });

    await handler(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.href).toBe("https://docs-chat.example.test/ask-molty/api/chat?q=docs");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    const forwarded = init.headers as Headers;
    expect(forwarded.get("x-request-id")).toBe("request-123");
    expect(forwarded.has("authorization")).toBe(false);
    expect(forwarded.has("cookie")).toBe(false);
  });
});
