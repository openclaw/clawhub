import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CHOICE_KEY, makeAnalyticsChoice } from "../lib/analyticsConsent";
import { AnalyticsChoices } from "./AnalyticsChoices";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schema_version: 1,
        policy_version: "2026-10-02.v2",
        region_class: "unknown",
      }),
    }),
  );
  delete document.documentElement.dataset.analyticsAllowed;
  delete document.documentElement.dataset.analyticsConsentEpoch;
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const allowed = () => document.documentElement.dataset.analyticsAllowed;

describe("saved analytics consent without choice UI", () => {
  it("renders no prompts or controls and never grants from a regional response", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schema_version: 1,
        policy_version: "2026-10-02.v2",
        region_class: "notice_opt_out",
      }),
    });
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<AnalyticsChoices />);
    expect(container.innerHTML).toBe("");
    expect(allowed()).toBe("false");
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(allowed()).toBe("false");
    expect(container.innerHTML).toBe("");
    expect(localStorage.getItem(ANALYTICS_CHOICE_KEY)).toBeNull();
  });

  it.each([
    null,
    "malformed",
    makeAnalyticsChoice("denied"),
    JSON.stringify({
      ...JSON.parse(makeAnalyticsChoice("granted")),
      policy_version: "2026-10-02.v1",
    }),
  ])("keeps absent, denied, invalid and obsolete consent off (%s)", (raw) => {
    if (raw !== null) localStorage.setItem(ANALYTICS_CHOICE_KEY, raw);
    const { container } = render(<AnalyticsChoices />);
    expect(allowed()).toBe("false");
    expect(container.innerHTML).toBe("");
    expect(localStorage.getItem(ANALYTICS_CHOICE_KEY)).toBe(raw);
  });

  it("honors a valid existing explicit grant without changing stored consent or auth", () => {
    const raw = makeAnalyticsChoice("granted");
    localStorage.setItem(ANALYTICS_CHOICE_KEY, raw);
    localStorage.setItem("existing-auth", "untouched");
    const { container } = render(<AnalyticsChoices />);
    expect(allowed()).toBe("true");
    expect(document.documentElement.dataset.analyticsConsentEpoch).not.toMatch(/^regional:/);
    expect(container.innerHTML).toBe("");
    expect(localStorage.getItem(ANALYTICS_CHOICE_KEY)).toBe(raw);
    expect(localStorage.getItem("existing-auth")).toBe("untouched");
  });

  it.each(["globalPrivacyControl", "doNotTrack"])("honors %s over a saved grant", (signal) => {
    localStorage.setItem(ANALYTICS_CHOICE_KEY, makeAnalyticsChoice("granted"));
    Object.defineProperty(navigator, signal, {
      configurable: true,
      value: signal === "doNotTrack" ? "1" : true,
    });
    render(<AnalyticsChoices />);
    expect(allowed()).toBe("false");
    Object.defineProperty(navigator, signal, {
      configurable: true,
      value: signal === "doNotTrack" ? null : false,
    });
    fireEvent.focus(window);
    expect(allowed()).toBe("true");
  });

  it("does not invent consent when a privacy signal disappears", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    render(<AnalyticsChoices />);
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
    fireEvent.focus(window);
    expect(allowed()).toBe("false");
  });

  it("refreshes cross-tab denial and cached-page consent before collection", () => {
    localStorage.setItem(ANALYTICS_CHOICE_KEY, makeAnalyticsChoice("granted"));
    render(<AnalyticsChoices />);
    expect(allowed()).toBe("true");
    localStorage.setItem(ANALYTICS_CHOICE_KEY, makeAnalyticsChoice("denied"));
    fireEvent(window, new Event("storage"));
    expect(allowed()).toBe("false");
    localStorage.setItem(ANALYTICS_CHOICE_KEY, makeAnalyticsChoice("granted"));
    fireEvent(window, new Event("pageshow"));
    expect(allowed()).toBe("true");
  });

  it("expires a saved grant at its boundary without creating a new choice", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const raw = JSON.stringify({
      ...JSON.parse(makeAnalyticsChoice("granted", now - 1000)),
      expires_at: new Date(now + 1000).toISOString(),
    });
    localStorage.setItem(ANALYTICS_CHOICE_KEY, raw);
    render(<AnalyticsChoices />);
    expect(allowed()).toBe("true");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(allowed()).toBe("false");
    expect(localStorage.getItem(ANALYTICS_CHOICE_KEY)).toBe(raw);
  });

  it("fails closed for this document after storage becomes unusable", () => {
    localStorage.setItem(ANALYTICS_CHOICE_KEY, makeAnalyticsChoice("granted"));
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    render(<AnalyticsChoices />);
    expect(allowed()).toBe("false");
    get.mockRestore();
    fireEvent.focus(window);
    expect(allowed()).toBe("false");
  });
});
