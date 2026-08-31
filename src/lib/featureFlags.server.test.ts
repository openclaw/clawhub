import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateInitialFeatureFlags, loadInitialFeatureFlags } from "./featureFlags.functions";

const { getRuntimeEnvMock } = vi.hoisted(() => ({
  getRuntimeEnvMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: <T>(handler: () => T) => handler,
  }),
}));

vi.mock("./runtimeEnv", () => ({
  getRuntimeEnv: getRuntimeEnvMock,
}));

const fetchMock = vi.fn<typeof fetch>();

describe("server feature flag evaluation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    getRuntimeEnvMock.mockReset();
  });

  it("does not contact Krill when evaluation is disabled", async () => {
    getRuntimeEnvMock.mockReturnValue(undefined);
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadInitialFeatureFlags()).resolves.toEqual({ values: null });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("evaluates the manifest with a shared non-visitor SSR context", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ flags: { homepageTestMessage: { value: true } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      evaluateInitialFeatureFlags({
        baseUrl: "https://flags.openclaw.ai",
        evalKey: "ks_clawhub_production_public",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ homepageTestMessage: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://flags.openclaw.ai/v1/eval",
      expect.objectContaining({
        body: JSON.stringify({ context: { key: "clawhub-homepage" } }),
        headers: expect.objectContaining({
          authorization: "Bearer ks_clawhub_production_public",
        }),
        method: "POST",
      }),
    );
  });
});
