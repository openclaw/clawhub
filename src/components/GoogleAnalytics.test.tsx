import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleAnalytics } from "./GoogleAnalytics";
import { SkillPublishSuccessDialog } from "./SkillPublishSuccessDialog";

const state = vi.hoisted(() => ({
  auth: { isAuthenticated: false, isLoading: true },
  routeId: "/",
  loaderData: undefined as unknown,
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
      return [{ routeId: state.routeId, status: "success", loaderData: state.loaderData }];
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
  state.loaderData = undefined;
  window.history.replaceState(null, "", "/");
  document.head.innerHTML = "";
  delete browser.gtag;
  delete browser.dataLayer;
  localStorage.clear();
  document.documentElement.dataset.analyticsConsentEpoch = "automatic-public:1";
  document.documentElement.dataset.analyticsAllowed = "false";
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: null });
});

function selections() {
  return (browser.dataLayer ?? [])
    .map((entry) => Array.from(entry))
    .filter(([kind, name]) => kind === "event" && name === "select_content");
}

describe("public outbound selection owner", () => {
  it.each([false, true])(
    "records one selection per footer/detail gesture for signed-in=%s",
    (isAuthenticated) => {
      state.auth = { isAuthenticated, isLoading: false };
      document.documentElement.dataset.analyticsAllowed = "true";
      const href = "https://example.test/shared?utm_source=public#section";
      const view = render(
        <>
          <GoogleAnalytics />
          <footer>
            <a href={href} onClick={(e) => e.preventDefault()}>
              Footer
            </a>
          </footer>
          <section data-analytics-public-detail="">
            <a href={href} onClick={(e) => e.preventDefault()}>
              Detail
            </a>
          </section>
        </>,
      );
      fireEvent.click(view.getByText("Footer"));
      fireEvent.click(view.getByText("Detail"));
      expect(selections().map((event) => event[2])).toMatchObject([
        {
          content_type: "resource",
          content_id: "footer_link",
          ui_location: "footer",
          link_url: "https://example.test/shared",
          link_domain: "example.test",
        },
        {
          content_type: "resource",
          content_id: "detail_link",
          ui_location: "detail",
          link_url: "https://example.test/shared",
          link_domain: "example.test",
        },
      ]);
      expect(view.getByText("Footer").getAttribute("href")).toBe(href);
      expect(
        (browser.dataLayer ?? [])
          .map((entry) => Array.from(entry))
          .filter((entry) => entry[0] === "event" && entry[1] === "click"),
      ).toHaveLength(0);
      expect(
        (browser.dataLayer ?? [])
          .map((entry) => Array.from(entry))
          .filter((entry) => entry[0] === "set")
          .every((entry) => !("ui_location" in (entry[1] as object))),
      ).toBe(true);
    },
  );

  it.each(["private", "loading", "GPC", "DNT"])("keeps %s models off", (mode) => {
    state.auth = { isAuthenticated: true, isLoading: mode === "loading" };
    state.routeId = mode === "private" ? "/settings" : "/";
    document.documentElement.dataset.analyticsAllowed = "true";
    if (mode === "GPC")
      Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    if (mode === "DNT")
      Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" });
    const view = render(
      <>
        <GoogleAnalytics />
        <footer>
          <a href="https://example.test/resource" onClick={(e) => e.preventDefault()}>
            External
          </a>
        </footer>
      </>,
    );
    fireEvent.click(view.getByText("External"));
    expect(selections()).toHaveLength(0);
    expect(document.querySelector('script[src*="googletagmanager.com"]')).toBeNull();
  });

  it("does not duplicate explicit selections or assign unknown/modal/menu placements", () => {
    state.auth = { isAuthenticated: false, isLoading: false };
    document.documentElement.dataset.analyticsAllowed = "true";
    const view = render(
      <>
        <GoogleAnalytics />
        <section data-analytics-public-detail="">
          <a
            href="https://example.test/"
            data-analytics-selection-owner="promotion"
            onClick={(e) => e.preventDefault()}
          >
            Owned
          </a>
          <div role="dialog">
            <a href="https://example.test/" onClick={(e) => e.preventDefault()}>
              Modal
            </a>
          </div>
          <div role="menu">
            <a href="https://example.test/" onClick={(e) => e.preventDefault()}>
              Menu
            </a>
          </div>
        </section>
        <aside>
          <a href="https://example.test/" onClick={(e) => e.preventDefault()}>
            Unknown
          </a>
        </aside>
      </>,
    );
    for (const label of ["Owned", "Modal", "Menu", "Unknown"])
      fireEvent.click(view.getByText(label));
    expect(selections()).toHaveLength(0);
  });

  it("preserves an internal navigation event without destination fields", () => {
    state.auth = { isAuthenticated: false, isLoading: false };
    document.documentElement.dataset.analyticsAllowed = "true";
    const view = render(
      <>
        <GoogleAnalytics />
        <footer>
          <a href="/skills" onClick={(e) => e.preventDefault()}>
            Skills
          </a>
        </footer>
      </>,
    );
    fireEvent.click(view.getByText("Skills"));
    expect(selections()).toHaveLength(1);
    expect(selections()[0][2]).toMatchObject({
      content_type: "navigation",
      content_id: "/skills",
      ui_location: "footer",
    });
    expect(selections()[0][2]).not.toHaveProperty("link_url");
    expect(selections()[0][2]).not.toHaveProperty("link_domain");
  });
});

describe("existing post-publish share selection", () => {
  const publicDetail = () => {
    state.routeId = "/$owner/skills/$slug";
    state.loaderData = {
      initialData: {
        result: { skill: { _id: "public-skill", moderationStatus: "active" }, latestVersion: {} },
      },
    };
    window.history.replaceState(null, "", "/owner/skills/public-skill");
  };
  const dialog = () => (
    <SkillPublishSuccessDialog
      isOpen
      displayName="Public Skill"
      skillPath="/owner/skills/public-skill"
      onDismiss={() => {}}
    />
  );

  it("enriches the actual public share anchor once, keeping the share identity and DOM URL", () => {
    state.auth = { isAuthenticated: true, isLoading: false };
    document.documentElement.dataset.analyticsAllowed = "true";
    publicDetail();
    const view = render(
      <>
        <GoogleAnalytics />
        {dialog()}
      </>,
    );
    const link = view.getByRole("link", { name: /Share on Twitter/ });
    const href = link.getAttribute("href");
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(selections()).toHaveLength(1);
    expect(selections()[0][2]).toMatchObject({
      content_type: "navigation",
      content_id: "share:x",
      ui_location: "publish",
      link_url: "https://twitter.com/intent/tweet",
      link_domain: "twitter.com",
    });
    expect(link.getAttribute("href")).toBe(href);
    expect(href).toContain("?text=");
  });

  it("does not emit or defer the same share from a private model before returning public", () => {
    state.auth = { isAuthenticated: true, isLoading: false };
    state.routeId = "/skills/publish";
    window.history.replaceState(null, "", "/skills/publish");
    document.documentElement.dataset.analyticsAllowed = "true";
    const view = render(
      <>
        <GoogleAnalytics />
        {dialog()}
      </>,
    );
    const link = view.getByRole("link", { name: /Share on Twitter/ });
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(selections()).toHaveLength(0);
    expect(document.querySelector('script[src*="googletagmanager.com"]')).toBeNull();
    publicDetail();
    act(() => consent(true));
    expect(selections()).toHaveLength(0);
  });
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
