import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateInitialFeatureFlags, loadInitialFeatureFlags } from "./featureFlags.functions";

const { getCookieMock, getRuntimeEnvMock, setCookieMock } = vi.hoisted(() => ({
  getCookieMock: vi.fn(),
  getRuntimeEnvMock: vi.fn(),
  setCookieMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: <T>(handler: () => T) => handler,
  }),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: getCookieMock,
  setCookie: setCookieMock,
}));

vi.mock("./runtimeEnv", () => ({
  getRuntimeEnv: getRuntimeEnvMock,
  isDevRuntime: () => true,
}));

const fetchMock = vi.fn<typeof fetch>();

describe("server feature flag evaluation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getCookieMock.mockReset();
    getRuntimeEnvMock.mockReset();
    setCookieMock.mockReset();
  });

  it("does not create a rollout cookie when evaluation is disabled", async () => {
    getRuntimeEnvMock.mockReturnValue(undefined);

    await expect(loadInitialFeatureFlags()).resolves.toEqual({ contextKey: null, values: null });

    expect(getCookieMock).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it("evaluates the manifest with the stable SSR context", async () => {
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
        contextKey: "anon-stable-context",
        evalKey: "ks_clawhub_production_public",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ homepageTestMessage: true });

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
