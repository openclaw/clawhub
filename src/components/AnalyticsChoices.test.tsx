import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_CHOICE_KEY,
  ANALYTICS_POLICY_VERSION,
  makeAnalyticsChoice,
} from "../lib/analyticsConsent";
import { AnalyticsChoices } from "./AnalyticsChoices";

beforeEach(() => {
  vi.stubEnv("VITE_GA4_ENABLED", "1");
  localStorage.clear();
  delete document.documentElement.dataset.analyticsAllowed;
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function regionResponse(region_class: string) {
  return {
    ok: true,
    json: async () => ({
      schema_version: 1,
      policy_version: ANALYTICS_POLICY_VERSION,
      region_class,
    }),
  } as Response;
}

describe("regional Google Analytics choices", () => {
  it("keeps unknown region off, permits explicit allow, and revokes immediately", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(regionResponse("unknown")));
    render(<AnalyticsChoices />);
    await screen.findByRole("button", { name: "Allow Google Analytics" });
    expect(document.documentElement.dataset.analyticsAllowed).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Allow Google Analytics" }));
    await waitFor(() => expect(document.documentElement.dataset.analyticsAllowed).toBe("true"));
    expect(JSON.parse(localStorage.getItem(ANALYTICS_CHOICE_KEY)!)).toMatchObject({
      analytics: "granted",
    });
    fireEvent.click(screen.getByRole("button", { name: "Google Analytics choices" }));
    fireEvent.click(screen.getByRole("button", { name: "Decline Google Analytics" }));
    expect(document.documentElement.dataset.analyticsAllowed).toBe("false");
  });
  it("shows a regional notice before default-on and does not fabricate an explicit choice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(regionResponse("notice_opt_out")));
    render(<AnalyticsChoices />);
    expect(document.documentElement.dataset.analyticsAllowed).toBe("false");
    await screen.findByRole("heading", { name: "Google Analytics on this site" });
    await waitFor(() => expect(document.documentElement.dataset.analyticsAllowed).toBe("true"));
    expect(localStorage.getItem(ANALYTICS_CHOICE_KEY)).toBeNull();
    expect(screen.getByText(/Existing Vercel analytics/)).toBeTruthy();
  });
  it.each(["granted", "denied"])(
    "fails closed for a v1 %s record until a fresh v2 choice",
    async (analytics) => {
      localStorage.setItem(
        ANALYTICS_CHOICE_KEY,
        JSON.stringify({
          ...JSON.parse(makeAnalyticsChoice("granted")),
          policy_version: "2026-10-02.v1",
          analytics,
        }),
      );
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(regionResponse("notice_opt_out")));
      render(<AnalyticsChoices />);
      await screen.findByRole("button", { name: "Allow Google Analytics" });
      expect(document.documentElement.dataset.analyticsAllowed).toBe("false");
      fireEvent.click(screen.getByRole("button", { name: "Allow Google Analytics" }));
      await waitFor(() => expect(document.documentElement.dataset.analyticsAllowed).toBe("true"));
      expect(JSON.parse(localStorage.getItem(ANALYTICS_CHOICE_KEY)!)).toMatchObject({
        policy_version: "2026-10-02.v2",
        analytics: "granted",
      });
    },
  );
  it("never lets a late regional default override explicit decline", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    render(<AnalyticsChoices />);
    fireEvent.click(screen.getByRole("button", { name: "Google Analytics choices" }));
    fireEvent.click(screen.getByRole("button", { name: "Decline Google Analytics" }));
    await act(async () => resolve(regionResponse("notice_opt_out")));
    expect(document.documentElement.dataset.analyticsAllowed).toBe("false");
  });
  it.each(["globalPrivacyControl", "doNotTrack"])(
    "shows the actual regional notice before granting after a closed %s panel",
    async (signal) => {
      Object.defineProperty(navigator, signal, {
        configurable: true,
        value: signal === "doNotTrack" ? "1" : true,
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(regionResponse("notice_opt_out")));
      render(<AnalyticsChoices />);
      await screen.findByText(
        "Google Analytics is off because your browser sends a privacy signal.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("heading", { name: "Google Analytics on this site" })).toBeNull();
      expect(document.documentElement.dataset.analyticsAllowed).toBe("false");
      const noticeAtGrant: boolean[] = [];
      const record = () => {
        if (document.documentElement.dataset.analyticsAllowed === "true")
          noticeAtGrant.push(
            Boolean(screen.queryByRole("heading", { name: "Google Analytics on this site" })),
          );
      };
      window.addEventListener("clawhub:analytics-preference", record);
      Object.defineProperty(navigator, signal, {
        configurable: true,
        value: signal === "doNotTrack" ? null : false,
      });
      fireEvent.focus(window);
      await screen.findByRole("heading", { name: "Google Analytics on this site" });
      await waitFor(() => expect(document.documentElement.dataset.analyticsAllowed).toBe("true"));
      expect(noticeAtGrant.length).toBeGreaterThan(0);
      expect(noticeAtGrant.every(Boolean)).toBe(true);
      window.removeEventListener("clawhub:analytics-preference", record);
    },
  );
  it.each(["globalPrivacyControl", "doNotTrack"])(
    "honors %s over a stored allow",
    async (signal) => {
      Object.defineProperty(navigator, signal, {
        configurable: true,
        value: signal === "doNotTrack" ? "1" : true,
      });
      localStorage.setItem(ANALYTICS_CHOICE_KEY, makeAnalyticsChoice("granted"));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(regionResponse("notice_opt_out")));
      render(<AnalyticsChoices />);
      fireEvent.click(screen.getByRole("button", { name: "Google Analytics choices" }));
      await screen.findByText(
        "Google Analytics is off because your browser sends a privacy signal.",
      );
      expect(document.documentElement.dataset.analyticsAllowed).toBe("false");
      expect(screen.queryByRole("button", { name: "Allow Google Analytics" })).toBeNull();
    },
  );
  it("keeps collection closed if the explicit preference cannot be saved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(regionResponse("unknown")));
    render(<AnalyticsChoices />);
    await screen.findByRole("button", { name: "Allow Google Analytics" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    fireEvent.click(screen.getByRole("button", { name: "Allow Google Analytics" }));
    await screen.findByText(
      "Google Analytics is off in this tab, but your choice could not be saved. It may not carry over to another tab or visit.",
    );
    expect(document.documentElement.dataset.analyticsAllowed).toBe("false");
  });
  it("restores only a manual opener with preventScroll, not the offscreen footer for an automatic notice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(regionResponse("unknown")));
    render(<AnalyticsChoices />);
    await screen.findByRole("button", { name: "Allow Google Analytics" });
    const footer = screen.getByRole("button", { name: "Google Analytics choices" });
    const focus = vi.spyOn(footer, "focus");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(focus).not.toHaveBeenCalled();
    fireEvent.click(footer);
    fireEvent.click(screen.getByRole("button", { name: "Decline Google Analytics" }));
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });
});
