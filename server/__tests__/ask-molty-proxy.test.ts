/* @vitest-environment node */

import { mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handler = (await import("../routes/ask-molty/[...]")).default;

const originalProxyOrigin = process.env.ASK_MOLTY_PROXY_ORIGIN;
const fetchMock = vi.fn(async (_target: URL, _init: RequestInit) => new Response("ok"));

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
        cookie: "clawhub_session=secret; ask_molty_session=signed.value; unrelated=value",
        "x-request-id": "request-123",
      },
    });

    await handler(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
    expect(String(target)).toBe("https://docs-chat.example.test/ask-molty/api/chat?q=docs");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    const forwarded = init.headers as Headers;
    expect(forwarded.get("x-request-id")).toBe("request-123");
    expect(forwarded.has("authorization")).toBe(false);
    expect(forwarded.get("cookie")).toBe("ask_molty_session=signed.value");
  });

  it("preserves the docs assistant sign-in redirect", async () => {
    const headers = new Headers({
      Location:
        "https://hub.openclaw.ai/docs/auth?return_to=https%3A%2F%2Fdocs-chat.openclaw.ai%2F",
    });
    headers.append("Set-Cookie", "clawhub_session=evil; Domain=clawhub.ai; Path=/");
    headers.append(
      "Set-Cookie",
      "ask_molty_session=signed.value; Max-Age=604800; Domain=clawhub.ai; Path=/; HttpOnly; Secure; SameSite=None",
    );
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers,
      }),
    );
    const event = mockEvent(
      "https://clawhub.ai/ask-molty/sign-in?return_to=https%3A%2F%2Fclawhub.ai%2Fdocs",
    );

    const response = await handler(event);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://clawhub.ai/auth/docs?return_to=https%3A%2F%2Fclawhub.ai%2Fdocs",
    );
    expect(response.headers.get("set-cookie")).toBe(
      "ask_molty_session=signed.value; Max-Age=604800; Path=/ask-molty; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("keeps local docs auth on the local ClawHub origin", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          Location:
            "https://hub.openclaw.ai/docs/auth?return_to=https%3A%2F%2Fdocs-chat.openclaw.ai%2F",
        },
      }),
    );
    const event = mockEvent(
      "http://127.0.0.1:3000/ask-molty/sign-in?return_to=http%3A%2F%2Flocalhost%3A4173%2Fdocs",
    );

    const response = await handler(event);

    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/auth/docs?return_to=http%3A%2F%2Flocalhost%3A4173%2Fdocs",
    );
  });
});
