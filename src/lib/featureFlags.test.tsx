/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagProvider, useFeatureFlag } from "./featureFlags";

const fetchMock = vi.fn<typeof fetch>();

function evalResponse(value: unknown): Response {
  return new Response(JSON.stringify({ flags: { souls: { value } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
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
    vi.unstubAllGlobals();
  });

  it("hydrates from server values without rendering the code default first", () => {
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
    const observedValues: boolean[] = [];

    function FirstRenderProbe() {
      observedValues.push(useFeatureFlag("souls"));
      return <FlagProbe />;
    }

    render(
      <FeatureFlagProvider
        baseUrl="https://flags.openclaw.ai"
        contextKey="user-123"
        evalKey="ks_clawhub_production_public"
        initialValues={{ souls: true }}
      >
        <FirstRenderProbe />
      </FeatureFlagProvider>,
    );

    expect(observedValues[0]).toBe(true);
    expect(screen.getByText("has soul")).toBeTruthy();
  });

  it("applies a successful browser refresh after hydration", async () => {
    fetchMock.mockResolvedValueOnce(evalResponse(false));

    render(
      <FeatureFlagProvider
        baseUrl="https://flags.openclaw.ai"
        contextKey="user-123"
        evalKey="ks_clawhub_production_public"
        initialValues={{ souls: true }}
      >
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    expect(screen.getByText("has soul")).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("safe default")).toBeTruthy();
  });

  it("renders code defaults without contacting Krill when no evaluation key is configured", () => {
    render(
      <FeatureFlagProvider evalKey="">
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    expect(screen.getByText("safe default")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
