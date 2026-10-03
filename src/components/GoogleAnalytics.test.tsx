import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleAnalytics } from "./GoogleAnalytics";

const state = vi.hoisted(() => ({
  auth: { isAuthenticated: false, isLoading: true },
  routeId: "/",
}));
vi.mock("../lib/useAuthStatus", () => ({ useAuthStatus: () => state.auth }));
vi.mock("../lib/analyticsEngagement", () => ({
  observeAnalyticsEngagement: () => () => {},
  observeAnalyticsPerformance: () => () => {},
  observeAnalyticsErrors: () => () => {},
}));
const router = {
  options: { ssr: { nonce: "fixture" } },
  state: {
    isLoading: false,
    status: "idle",
    get matches() {
      return [{ routeId: state.routeId, status: "success" }];
    },
  },
  subscribe: () => () => {},
};
vi.mock("@tanstack/react-router", () => ({ useRouter: () => router }));
vi.mock("../lib/googleAnalytics", async (original) => {
  const actual = await original<typeof import("../lib/googleAnalytics")>();
  return {
    ...actual,
    getGoogleAnalyticsPage: (input: Parameters<typeof actual.getGoogleAnalyticsPage>[0]) =>
      actual.getGoogleAnalyticsPage({
        ...input,
        href: `https://clawhub.ai${new URL(input.href).pathname}`,
      }),
  };
});

const browser = window as Window & { dataLayer?: IArguments[]; gtag?: unknown };
function logins() {
  return (browser.dataLayer ?? [])
    .map((entry) => Array.from(entry))
    .filter(([kind, name]) => kind === "event" && name === "login");
}
function consent(allowed: boolean) {
  document.documentElement.dataset.analyticsAllowed = String(allowed);
  window.dispatchEvent(new Event("clawhub:analytics-preference"));
}
beforeEach(() => {
  vi.stubEnv("VITE_CLAWHUB_DEPLOY_ENV", "production");
  state.auth = { isAuthenticated: false, isLoading: true };
  state.routeId = "/";
  document.head.innerHTML = "";
  delete browser.gtag;
  delete browser.dataLayer;
  localStorage.clear();
  document.documentElement.dataset.analyticsConsentEpoch = "automatic-public:1";
  document.documentElement.dataset.analyticsAllowed = "false";
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete browser.gtag;
  delete browser.dataLayer;
});

describe("login acknowledgment consent chronology", () => {
  it("does not replay a denied ACK when consent arrives before auth resolution", () => {
    const view = render(<GoogleAnalytics />);
    act(() => {
      window.dispatchEvent(new Event("clawhub:login-acknowledged"));
    });
    act(() => consent(true));
    state.auth = { isAuthenticated: true, isLoading: false };
    view.rerender(<GoogleAnalytics />);
    expect(logins()).toHaveLength(0);
  });
  it("emits an allowed public ACK only once after authoritative auth resolution", () => {
    document.documentElement.dataset.analyticsAllowed = "true";
    const view = render(<GoogleAnalytics />);
    act(() => {
      window.dispatchEvent(new Event("clawhub:login-acknowledged"));
    });
    expect(logins()).toHaveLength(0);
    state.auth = { isAuthenticated: true, isLoading: false };
    view.rerender(<GoogleAnalytics />);
    act(() => consent(true));
    expect(logins()).toHaveLength(1);
  });
  it("clears an allowed pending ACK on opt-out before a later regrant", () => {
    document.documentElement.dataset.analyticsAllowed = "true";
    const view = render(<GoogleAnalytics />);
    act(() => {
      window.dispatchEvent(new Event("clawhub:login-acknowledged"));
    });
    act(() => consent(false));
    act(() => consent(true));
    state.auth = { isAuthenticated: true, isLoading: false };
    view.rerender(<GoogleAnalytics />);
    expect(logins()).toHaveLength(0);
  });
  it("defers a consented authoritative private login only in a fixed workflow context", () => {
    document.documentElement.dataset.analyticsAllowed = "true";
    state.routeId = "/settings";
    const view = render(<GoogleAnalytics />);
    act(() => {
      window.dispatchEvent(new Event("clawhub:login-acknowledged"));
    });
    state.auth = { isAuthenticated: true, isLoading: false };
    view.rerender(<GoogleAnalytics />);
    expect(logins()).toHaveLength(0);
    state.routeId = "/";
    act(() => consent(true));
    expect(logins()).toHaveLength(1);
    expect(logins()[0][2]).toMatchObject({
      page_location: "https://clawhub.ai/_analytics/workflows/authentication",
      ui_location: "authentication",
      event_deferred: 1,
    });
  });
});
