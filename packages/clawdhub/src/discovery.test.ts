/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlobalStubRegistry } from "../test/runtimeStubs.js";
import { discoverRegistryFromSite } from "./discovery";

const globalStubs = createGlobalStubRegistry();

describe("discovery", () => {
  afterEach(() => {
    globalStubs.restoreAll();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns null on non-ok response", async () => {
    globalStubs.stub(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch,
    );
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toBeNull();
  });

  it("parses registry config", async () => {
    globalStubs.stub(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ registry: "https://example.convex.site" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toEqual({
      apiBase: "https://example.convex.site",
      authBase: undefined,
      minCliVersion: undefined,
    });
  });

  it("parses apiBase config", async () => {
    globalStubs.stub(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              apiBase: "https://api.example.com",
              authBase: "https://auth.example.com",
              minCliVersion: "1.2.3",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ) as unknown as typeof fetch,
    );
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toEqual({
      apiBase: "https://api.example.com",
      authBase: "https://auth.example.com",
      minCliVersion: "1.2.3",
    });
  });

  it("returns null when apiBase is empty", async () => {
    globalStubs.stub(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ apiBase: "" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toBeNull();
  });
});
