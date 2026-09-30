/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { getRouter } from "./router";

vi.mock("./routeTree.gen", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { routeTree: createRootRoute() };
});

afterEach(() => vi.unstubAllEnvs());

describe("request router CSP nonce", () => {
  it("initializes a fresh nonce before the framework attaches SSR serialization", () => {
    vi.stubEnv("SSR", true);

    const first = getRouter().options.ssr?.nonce;
    const second = getRouter().options.ssr?.nonce;

    expect(first).toMatch(/^[A-Za-z0-9+/]{24}$/);
    expect(second).toMatch(/^[A-Za-z0-9+/]{24}$/);
    expect(first).not.toBe(second);
  });

  it("does not invent a second nonce when creating the client router", () => {
    vi.stubEnv("SSR", false);

    expect(getRouter().options.ssr?.nonce).toBeUndefined();
  });
});
