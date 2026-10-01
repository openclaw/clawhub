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

function stubRejectingFetch(error: Error) {
  globalStubs.stub("fetch", vi.fn(async () => Promise.reject(error)) as unknown as typeof fetch);
}

function stubStalledBodyFetch() {
  globalStubs.stub(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      // Return a response with headers immediately, but body never completes
      const response = new Response(null, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      // Override .json() to hang forever (or abort if signal fires)
      response.json = vi.fn(
        () =>
          new Promise<unknown>((_resolve, reject) => {
            if (!signal) return; // hangs forever
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          }),
      );
      return response;
    }) as unknown as typeof fetch,
  );
}

describe("discoverRegistryFromSite timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it("clears the timeout when fetch rejects before returning headers", async () => {
    vi.useFakeTimers();
    const error = new Error("connection refused");
    stubRejectingFetch(error);

    await expect(discoverRegistryFromSite("https://example.com")).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it(
    "rejects with a timeout error when the response body never completes",
    { timeout: 5_000 },
    async () => {
      stubStalledBodyFetch();
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
