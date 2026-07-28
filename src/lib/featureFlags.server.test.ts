import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateInitialFeatureFlags } from "./featureFlags.functions";

const fetchMock = vi.fn<typeof fetch>();

describe("server feature flag evaluation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("evaluates the manifest with the stable SSR context", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ flags: { souls: { value: true } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      evaluateInitialFeatureFlags({
        baseUrl: "https://flags.openclaw.ai",
        contextKey: "anon-stable-context",
        evalKey: "ks_clawhub_production_public",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ souls: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://flags.openclaw.ai/v1/eval",
      expect.objectContaining({
        body: JSON.stringify({ context: { key: "anon-stable-context" } }),
        headers: expect.objectContaining({
          authorization: "Bearer ks_clawhub_production_public",
        }),
        method: "POST",
      }),
    );
  });
});
