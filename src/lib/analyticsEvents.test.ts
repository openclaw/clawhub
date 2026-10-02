import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_CHOICE_KEY,
  analyticsChoiceEpoch,
  makeAnalyticsChoice,
} from "./analyticsConsent";
import {
  analyticsEventParameters,
  analyticsSearchFilter,
  emitPublicSearchSubmission,
  captureAnalyticsOperation,
  registerAnalyticsOperations,
  normalizeNonfunctionalSearchKeys,
  isSafeNativeSearchContext,
  analyticsPreferenceAllowsCollection,
  isSensitiveAnalyticsDestination,
  publicAnalyticsContentId,
  safePublicSearchTerm,
  safeReferralOrigin,
} from "./analyticsEvents";

afterEach(() => {
  delete document.documentElement.dataset.analyticsAllowed;
  vi.restoreAllMocks();
});
describe("analytics privacy boundaries", () => {
  it("normalizes all five nonfunctional native keys without rewriting UTM/linker/history URL bytes", () => {
    for (const key of ["q", "s", "search", "query", "keyword"]) {
      const href = `https://clawhub.ai/?utm_source=a%20b&${key}=PRIVATE%40example.test&_gl=1*abc%2Fdef#keep-fragment`;
      expect(normalizeNonfunctionalSearchKeys(href)).toBe(
        "https://clawhub.ai/?utm_source=a%20b&_gl=1*abc%2Fdef#keep-fragment",
      );
      expect(
        normalizeNonfunctionalSearchKeys(
          `https://clawhub.ai/publisher/skills/resource?${key}=PRIVATE`,
        ),
      ).toBe("https://clawhub.ai/publisher/skills/resource");
    }
  });
  it("preserves functional q verbatim and fails closed for sensitive/duplicate/unsupported contexts", () => {
    expect(
      normalizeNonfunctionalSearchKeys(
        "https://clawhub.ai/search?q=calendar%20automation&utm_source=a%20b&query=PRIVATE#same",
      ),
    ).toBe("https://clawhub.ai/search?q=calendar%20automation&utm_source=a%20b#same");
    expect(normalizeNonfunctionalSearchKeys("https://clawhub.ai/dashboard?q=private%20query")).toBe(
      "https://clawhub.ai/dashboard?q=private%20query",
    );
    expect(isSafeNativeSearchContext(new URL("https://clawhub.ai/search?q=calendar"))).toBe(true);
    for (const path of [
      "/?q=calendar",
      "/search?query=PRIVATE",
      "/search?q=visitor@example.test",
      "/search?q=calendar&q=PRIVATE",
      "/search?Q=calendar",
      "/official?q=person",
      "/search?q=calendar&type=creators",
    ])
      expect(isSafeNativeSearchContext(new URL(path, "https://clawhub.ai"))).toBe(false);
  });
  it("fails closed until the regional/explicit-choice owner grants collection", () => {
    expect(analyticsPreferenceAllowsCollection()).toBe(false);
    document.documentElement.dataset.analyticsConsentEpoch =
      "regional:2026-10-02.v2:notice_opt_out";
    document.documentElement.dataset.analyticsAllowed = "true";
    expect(analyticsPreferenceAllowsCollection()).toBe(true);
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" });
    expect(analyticsPreferenceAllowsCollection()).toBe(false);
  });
  it("keeps public search phrases but rejects common sensitive values", () => {
    expect(safePublicSearchTerm("  calendar   automation ")).toBe("calendar automation");
    for (const value of [
      "name@example.test",
      "1234567890",
      "api_key abc",
      "Bearer key",
      "https://private.test/?token=abc",
      "a".repeat(100),
    ])
      expect(safePublicSearchTerm(value)).toBeNull();
  });
  it("keeps public resource identities including public publisher handles", () => {
    expect(publicAnalyticsContentId("plugin", "@publisher/public-plugin")).toBe(
      "plugin:@publisher/public-plugin",
    );
  });
  it("keeps referral origins but never referrer paths, credentials, queries, or fragments", () => {
    expect(safeReferralOrigin("https://chatgpt.com/c/private-chat?token=secret#message")).toBe(
      "https://chatgpt.com/",
    );
    expect(safeReferralOrigin("https://user:pass@example.test/path")).toBe("");
    expect(safeReferralOrigin("http://127.0.0.1/private")).toBe("");
  });
  it("preserves ordinary public outbound links but identifies credential-bearing destinations", () => {
    const origin = "https://clawhub.ai";
    expect(
      isSensitiveAnalyticsDestination("https://github.com/public-owner/public-project", origin),
    ).toBe(false);
    expect(
      isSensitiveAnalyticsDestination("https://docs.openclaw.ai/clawhub/#install", origin),
    ).toBe(false);
    for (const href of [
      "https://example.test/?token=abc",
      "https://example.test/#access_token=abc",
      "https://user:pass@example.test/",
      "https://example.test/?email=person@example.test",
      "https://example.test/private/message",
      "mailto:person@example.test",
      "http://[invalid",
    ])
      expect(isSensitiveAnalyticsDestination(href, origin)).toBe(true);
  });
  it("exports only a bounded filter category, never the selected user-provided value", () => {
    expect(analyticsSearchFilter({})).toBe("none");
    expect(analyticsSearchFilter({ category: "private-looking-input" })).toBe("category");
    expect(analyticsSearchFilter({ topic: "private-looking-input" })).toBe("topic");
    expect(analyticsSearchFilter({ sort: "updated" })).toBe("sort");
    expect(analyticsSearchFilter({ featured: true })).toBe("featured");
    expect(
      analyticsSearchFilter({
        category: "category",
        topic: "topic",
        sort: "updated",
        featured: true,
      }),
    ).toBe("multiple");
    for (const sort of ["recommended", "relevance", "default", { private: "input" }])
      expect(analyticsSearchFilter({ sort })).toBe("none");
  });
  it("emits a normalized explicit search only under permission and filters sensitive terms", () => {
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: null });
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
    localStorage.clear();
    document.documentElement.dataset.analyticsConsentEpoch =
      "regional:2026-10-02.v2:notice_opt_out";
    const listener = vi.fn();
    window.addEventListener("clawhub:analytics", listener);
    emitPublicSearchSubmission("calendar", "skills", "header");
    expect(listener).not.toHaveBeenCalled();
    document.documentElement.dataset.analyticsAllowed = "true";
    emitPublicSearchSubmission("visitor@example.test", "skills", "header");
    expect(listener).not.toHaveBeenCalled();
    emitPublicSearchSubmission(" calendar   automation ", "skills", "header");
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toMatchObject({
      name: "search",
      params: {
        search_term: "calendar automation",
        search_context: "skills",
        ui_location: "header",
      },
    });
    window.removeEventListener("clawhub:analytics", listener);
  });
});

it("projects only permitted bounded event fields and rejects unexpected values", () => {
  expect(analyticsEventParameters({ name: "not_an_event", params: {} } as never)).toEqual({});
  expect(
    analyticsEventParameters({
      name: "resource_action",
      params: {
        action: "search_results",
        content_type: "search",
        action_result: "success",
        result_count: Infinity,
        search_context: "x\nprivate",
        private_input: "secret",
        content_id: "x".repeat(101),
      },
    } as never),
  ).toEqual({ action: "search_results", content_type: "search", action_result: "success" });
  expect(
    analyticsEventParameters({ name: "resource_action", params: { result_count: -1 } } as never),
  ).toEqual({});
  expect(
    analyticsEventParameters({ name: "resource_action", params: { result_count: 0 } } as never),
  ).toEqual({ result_count: 0 });
});

it("fails closed on storage changes and privacy signals instead of trusting a stale DOM grant", () => {
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: null });
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  document.documentElement.dataset.analyticsAllowed = "true";
  const choice = makeAnalyticsChoice("granted");
  localStorage.setItem(ANALYTICS_CHOICE_KEY, choice);
  document.documentElement.dataset.analyticsConsentEpoch = analyticsChoiceEpoch(choice);
  expect(analyticsPreferenceAllowsCollection()).toBe(true);
  document.documentElement.dataset.analyticsConsentEpoch = "mismatched";
  expect(analyticsPreferenceAllowsCollection()).toBe(false);
  localStorage.setItem(ANALYTICS_CHOICE_KEY, makeAnalyticsChoice("denied"));
  expect(analyticsPreferenceAllowsCollection()).toBe(false);
  localStorage.setItem(ANALYTICS_CHOICE_KEY, "malformed");
  expect(analyticsPreferenceAllowsCollection()).toBe(false);
  localStorage.clear();
  document.documentElement.dataset.analyticsConsentEpoch = "regional:2026-10-02.v2:notice_opt_out";
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
  expect(analyticsPreferenceAllowsCollection()).toBe(false);
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("no storage");
  });
  expect(analyticsPreferenceAllowsCollection()).toBe(false);
});

it("uses capture-time permission and contains failed measurement without changing the product result", () => {
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: null });
  document.documentElement.dataset.analyticsAllowed = "true";
  document.documentElement.dataset.analyticsConsentEpoch = "regional:2026-10-02.v2:notice_opt_out";
  localStorage.clear();
  expect(captureAnalyticsOperation()).toBeNull();
  const removeFirst = registerAnalyticsOperations(() => null);
  expect(captureAnalyticsOperation()).toBeNull();
  let valid = true;
  const send = vi.fn(() => {
    throw new Error("SDK problem");
  });
  const remove = registerAnalyticsOperations(() => ({ isValid: () => valid, send }));
  removeFirst();
  const operation = captureAnalyticsOperation()!;
  expect(
    operation.emit("copy_action", {
      content_type: "install",
      action_result: "success",
      ui_location: "install",
    }),
  ).toBe(false);
  expect(send).toHaveBeenCalledOnce();
  valid = false;
  expect(
    operation.emit("copy_action", {
      content_type: "install",
      action_result: "success",
      ui_location: "install",
    }),
  ).toBe(false);
  expect(send).toHaveBeenCalledOnce();
  remove();
  expect(captureAnalyticsOperation()).toBeNull();
});
