import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsPreferenceAllowsCollection,
  captureAnalyticsOperation,
  registerAnalyticsOperations,
} from "../lib/analyticsEvents";
import { AnalyticsEligibility } from "./AnalyticsEligibility";

const legacyKey = "clawhub.analytics.choice";
const legacy = (analytics: string, patch = {}) =>
  JSON.stringify({
    schema_version: 1,
    policy_version: "2026-10-02.v2",
    analytics,
    updated_at: "2026-10-02T00:00:00Z",
    expires_at: "2027-01-01T00:00:00Z",
    ...patch,
  });
const allowed = () => document.documentElement.dataset.analyticsAllowed;
const epoch = () => document.documentElement.dataset.analyticsConsentEpoch;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
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

describe("automatic public analytics eligibility", () => {
  it.each([
    null,
    legacy("granted"),
    legacy("denied"),
    "malformed",
    legacy("granted", { expires_at: "2020-01-01T00:00:00Z" }),
    legacy("denied", { policy_version: "2026-10-02.v1" }),
  ])("ignores old records without reading, changing or migrating them: %s", (raw) => {
    if (raw !== null) localStorage.setItem(legacyKey, raw);
    const read = vi.spyOn(Storage.prototype, "getItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    const { container } = render(<AnalyticsEligibility />);
    expect(allowed()).toBe("true");
    expect(analyticsPreferenceAllowsCollection()).toBe(true);
    const firstEpoch = epoch();
    fireEvent.focus(window);
    fireEvent(window, new Event("storage"));
    fireEvent(window, new Event("pageshow"));
    expect(epoch()).toBe(firstEpoch);
    expect(container.innerHTML).toBe("");
    expect(fetch).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    read.mockRestore();
    expect(localStorage.getItem(legacyKey)).toBe(raw);
  });

  it("starts without storage access or a regional response", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    render(<AnalyticsEligibility />);
    expect(allowed()).toBe("true");
    expect(analyticsPreferenceAllowsCollection()).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["globalPrivacyControl", "doNotTrack"])(
    "honors %s before startup and on refresh",
    (signal) => {
      Object.defineProperty(navigator, signal, {
        configurable: true,
        value: signal === "doNotTrack" ? "1" : true,
      });
      render(<AnalyticsEligibility />);
      expect(allowed()).toBe("false");
      expect(epoch()).toBe("");
      Object.defineProperty(navigator, signal, {
        configurable: true,
        value: signal === "doNotTrack" ? null : false,
      });
      fireEvent.focus(window);
      expect(allowed()).toBe("true");
      const activeEpoch = epoch();
      Object.defineProperty(navigator, signal, {
        configurable: true,
        value: signal === "doNotTrack" ? "1" : true,
      });
      // The event helper blocks immediately, even before native gate refresh.
      expect(analyticsPreferenceAllowsCollection()).toBe(false);
      fireEvent(document, new Event("visibilitychange"));
      expect(allowed()).toBe("false");
      Object.defineProperty(navigator, signal, {
        configurable: true,
        value: signal === "doNotTrack" ? null : false,
      });
      fireEvent(window, new Event("pageshow"));
      expect(allowed()).toBe("true");
      expect(epoch()).not.toBe(activeEpoch);
    },
  );

  it("never revalidates an asynchronous operation across a browser-signal interval", () => {
    const send = vi.fn();
    const unregister = registerAnalyticsOperations(() => ({ isValid: () => true, send }));
    render(<AnalyticsEligibility />);
    const operation = captureAnalyticsOperation()!;
    expect(operation.isValid()).toBe(true);
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    fireEvent.focus(window);
    expect(captureAnalyticsOperation()).toBeNull();
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
    fireEvent.focus(window);
    expect(operation.isValid()).toBe(false);
    expect(captureAnalyticsOperation()?.isValid()).toBe(true);
    expect(send).not.toHaveBeenCalled();
    unregister();
  });

  it("refreshes browser signals on resume and periodic checks, and removes listeners on unmount", () => {
    vi.useFakeTimers();
    const view = render(<AnalyticsEligibility />);
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    fireEvent(document, new Event("resume"));
    expect(allowed()).toBe("false");
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
    vi.advanceTimersByTime(60_000);
    expect(allowed()).toBe("true");
    view.unmount();
    const last = epoch();
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    fireEvent.focus(window);
    vi.advanceTimersByTime(60_000);
    expect(epoch()).toBe(last);
  });
});
