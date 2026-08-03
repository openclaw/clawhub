/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlobalStubRegistry } from "../test/runtimeStubs.js";
import { discoverRegistryFromSite } from "./discovery";

const globalStubs = createGlobalStubRegistry();

function stubNeverResolvingFetch() {
  globalStubs.stub(
    "fetch",
    vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return; // hangs forever, like an endpoint that never answers
          signal.addEventListener("abort", () => {
            reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
          });
        }),
    ) as unknown as typeof fetch,
  );
}

function stubJsonFetch(status: number, body: unknown) {
  globalStubs.stub(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch,
  );
}

describe("discoverRegistryFromSite timeout", () => {
  afterEach(() => {
    globalStubs.restoreAll();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it(
    "rejects with a timeout error when the endpoint never responds",
    { timeout: 5_000 },
    async () => {
      stubNeverResolvingFetch();
      await expect(discoverRegistryFromSite("https://example.com", 50)).rejects.toThrow(
        /Request timed out after \d+s/,
      );
    },
  );

  it("still parses a valid well-known config", async () => {
    stubJsonFetch(200, { registry: "https://example.convex.site" });
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toEqual({
      apiBase: "https://example.convex.site",
      authBase: undefined,
      minCliVersion: undefined,
    });
  });

  it("still returns null when both well-known paths 404", async () => {
    stubJsonFetch(404, { error: "nope" });
    await expect(discoverRegistryFromSite("https://example.com")).resolves.toBeNull();
  });
});
