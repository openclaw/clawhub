/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import middleware, { config } from "./middleware";

function getForwardedHeader(response: Response, name: string) {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("Vercel API middleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds an edge trust secret and Vercel-derived client IP for Convex rewrites", () => {
    vi.stubEnv("CLAWHUB_EDGE_SECRET", "edge-secret");
    const response = middleware(
      new Request("https://clawhub.ai/api/v1/packages/demo", {
        headers: {
          "x-clawhub-edge-secret": "caller-secret",
          "cf-connecting-ip": "192.0.2.10",
          "x-forwarded-for": "192.0.2.11",
          "x-real-ip": "203.0.113.9",
          "fly-client-ip": "192.0.2.12",
        },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(getForwardedHeader(response, "x-clawhub-edge-secret")).toBe("edge-secret");
    expect(getForwardedHeader(response, "x-forwarded-for")).toBe("203.0.113.9");
    expect(getForwardedHeader(response, "x-real-ip")).toBe("203.0.113.9");
    expect(getForwardedHeader(response, "cf-connecting-ip")).toBeNull();
    expect(getForwardedHeader(response, "fly-client-ip")).toBeNull();
  });

  it("strips caller-supplied trust and IP headers when edge trust is not configured", () => {
    const response = middleware(
      new Request("https://clawhub.ai/api/v1/packages/demo", {
        headers: {
          "x-clawhub-edge-secret": "caller-secret",
          "cf-connecting-ip": "192.0.2.10",
          "x-forwarded-for": "192.0.2.11",
          "x-real-ip": "203.0.113.9",
          "fly-client-ip": "192.0.2.12",
        },
      }),
    );

    expect(getForwardedHeader(response, "x-clawhub-edge-secret")).toBeNull();
    expect(getForwardedHeader(response, "cf-connecting-ip")).toBeNull();
    expect(getForwardedHeader(response, "x-forwarded-for")).toBeNull();
    expect(getForwardedHeader(response, "x-real-ip")).toBeNull();
    expect(getForwardedHeader(response, "fly-client-ip")).toBeNull();
  });

  it("runs only on Convex-backed API and feed routes", () => {
    expect(config.matcher).toEqual(["/api/:path*", "/v1/feeds/plugins", "/v1/feeds/skills"]);
  });
});
