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

  it("keeps an http apiBase on a normal host", async () => {
    globalStubs.stub(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ apiBase: "http://hub.example:8080" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toEqual({
      apiBase: "http://hub.example:8080",
      authBase: undefined,
      minCliVersion: undefined,
    });
  });

  it("keeps a bracketed IPv6 loopback apiBase", async () => {
    globalStubs.stub(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ apiBase: "http://[::1]:3210" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toEqual({
      apiBase: "http://[::1]:3210",
      authBase: undefined,
      minCliVersion: undefined,
    });
  });

  it("ignores an apiBase that is not http or https", async () => {
    globalStubs.stub(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ apiBase: "file:///tmp/registry" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toBeNull();
  });

  it("ignores an apiBase that contains credentials", async () => {
    globalStubs.stub(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ apiBase: "https://user@evil.example" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toBeNull();
  });

  it("accepts loopback http and drops an unsafe authBase", async () => {
    globalStubs.stub(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              apiBase: "http://127.0.0.1:3210",
              authBase: "file:///tmp/auth",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ) as unknown as typeof fetch,
    );
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toEqual({
      apiBase: "http://127.0.0.1:3210",
      authBase: undefined,
      minCliVersion: undefined,
    });
  });
});
