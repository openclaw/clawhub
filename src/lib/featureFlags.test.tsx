/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateFeatureFlags, FeatureFlagProvider, useFeatureFlag } from "./featureFlags";

const fetchMock = vi.fn<typeof fetch>();

function evalResponse(value: unknown, options?: { etag?: string; status?: number }): Response {
  return new Response(JSON.stringify({ flags: { souls: { value } } }), {
    status: options?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(options?.etag ? { etag: options.etag } : {}),
    },
  });
}

function FlagProbe() {
  return <span>{useFeatureFlag("souls") ? "has soul" : "safe default"}</span>;
}

describe("feature flags", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("evaluates flags through the public Krill Switch API", async () => {
    fetchMock.mockResolvedValueOnce(evalResponse(true, { etag: 'W/"flags-v1"' }));

    const result = await evaluateFeatureFlags({
      baseUrl: "https://flags.openclaw.ai",
      contextKey: "user-123",
      evalKey: "ks_clawhub_production_public",
    });

    expect(result).toEqual({
      kind: "updated",
      etag: 'W/"flags-v1"',
      values: { souls: true },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://flags.openclaw.ai/v1/eval"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer ks_clawhub_production_public",
        }),
        body: JSON.stringify({ context: { key: "user-123" } }),
      }),
    );
  });

  it("keeps the code default when a remote value has the wrong type", async () => {
    fetchMock.mockResolvedValueOnce(evalResponse("yes"));

    await expect(
      evaluateFeatureFlags({
        baseUrl: "https://flags.openclaw.ai/",
        contextKey: "user-123",
        evalKey: "ks_clawhub_production_public",
      }),
    ).resolves.toMatchObject({ values: { souls: false } });
  });

  it("renders defaults immediately and applies a successful evaluation", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(
      <FeatureFlagProvider
        baseUrl="https://flags.openclaw.ai"
        contextKey="user-123"
        evalKey="ks_clawhub_production_public"
      >
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    expect(screen.getByText("safe default")).toBeTruthy();
    await act(async () => {
      resolveFetch?.(evalResponse(true));
    });
    expect(screen.getByText("has soul")).toBeTruthy();
  });

  it("keeps cached values out of the first render to prevent hydration mismatches", () => {
    localStorage.setItem(
      "clawhub.featureFlags.ks_clawhub_production_public.user-123",
      JSON.stringify({ souls: true }),
    );
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
    const observedValues: boolean[] = [];

    function FirstRenderProbe() {
      observedValues.push(useFeatureFlag("souls"));
      return null;
    }

    render(
      <FeatureFlagProvider contextKey="user-123" evalKey="ks_clawhub_production_public">
        <FirstRenderProbe />
      </FeatureFlagProvider>,
    );

    expect(observedValues[0]).toBe(false);
  });

  it("uses the ETag on later polls and preserves the current value on 304", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(evalResponse(true, { etag: 'W/"flags-v1"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));

    render(
      <FeatureFlagProvider
        baseUrl="https://flags.openclaw.ai"
        contextKey="user-123"
        evalKey="ks_clawhub_production_public"
        pollIntervalMs={1_000}
      >
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("has soul")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ "if-none-match": 'W/"flags-v1"' }),
      }),
    );
    expect(screen.getByText("has soul")).toBeTruthy();
  });

  it("does not call the service when no evaluation key is configured", () => {
    render(
      <FeatureFlagProvider evalKey="">
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    expect(screen.getByText("safe default")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
