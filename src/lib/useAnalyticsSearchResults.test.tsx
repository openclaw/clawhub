import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAnalyticsOperations } from "./analyticsEvents";
import { createGoogleAnalytics } from "./googleAnalytics";
import { useAnalyticsSearchResults } from "./useAnalyticsSearchResults";

const browser = window as Window & { dataLayer?: IArguments[]; gtag?: unknown };
const page = {
  page_location: "https://clawhub.ai/search?q=calendar",
  page_title: "Search - ClawHub",
  page_referrer: "",
};
const epoch = "automatic-public:1";
let tracker: ReturnType<typeof createGoogleAnalytics>;
let unregister: () => void;
const observations = () =>
  (browser.dataLayer ?? [])
    .map((entry) => Array.from(entry))
    .filter((entry) => entry[1] === "resource_action")
    .map((entry) => entry[2]);
function gate(allowed: boolean) {
  document.documentElement.dataset.analyticsAllowed = String(allowed);
  document.documentElement.dataset.analyticsConsentEpoch = allowed ? epoch : "";
  tracker.update(allowed ? page : null, "/search", {
    collectionAllowed: allowed,
    consentEpoch: epoch,
  });
}
beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
  delete browser.gtag;
  delete browser.dataLayer;
  tracker = createGoogleAnalytics("fixture");
  unregister = registerAnalyticsOperations((workflow) => tracker.captureOperation(workflow));
  gate(true);
});
afterEach(() => {
  cleanup();
  unregister();
  delete browser.gtag;
  delete browser.dataLayer;
  vi.useRealTimers();
});

describe("rendered search observations", () => {
  const props = {
    query: "calendar",
    count: 0,
    loading: true,
    failed: false,
    context: "skills" as const,
    complete: true,
  };
  it("waits for rendered results and reports a complete zero only once", async () => {
    const { rerender } = renderHook(useAnalyticsSearchResults, { initialProps: props });
    expect(observations()).toHaveLength(0);
    rerender({ ...props, loading: false });
    rerender({ ...props, loading: false });
    await waitFor(() => expect(observations()).toHaveLength(1));
    expect(observations()[0]).toMatchObject({
      action: "search_results",
      result_count: 0,
      search_status: "complete",
    });
  });
  it("does not turn errors or partial emptiness into zero-results", async () => {
    const { rerender } = renderHook(useAnalyticsSearchResults, {
      initialProps: { ...props, loading: false, failed: true },
    });
    await waitFor(() => expect(observations()).toHaveLength(1));
    expect(observations()[0]).toMatchObject({ search_status: "error", action_result: "error" });
    expect(observations()[0]).not.toHaveProperty("result_count");
    rerender({ ...props, loading: false, failed: false, complete: false });
    await waitFor(() => expect(observations()).toHaveLength(2));
    expect(observations()[1]).not.toHaveProperty("result_count");
  });
  it("ignores sensitive input and loading keystroke states", () => {
    renderHook(useAnalyticsSearchResults, {
      initialProps: { ...props, loading: false, query: "visitor@example.test" },
    });
    expect(observations()).toHaveLength(0);
  });
  it("reports capped rendered entries as a partial observation", async () => {
    renderHook(useAnalyticsSearchResults, {
      initialProps: { ...props, loading: false, count: 25, complete: false },
    });
    await waitFor(() => expect(observations()).toHaveLength(1));
    expect(observations()[0]).toMatchObject({ result_count: 25, search_status: "partial" });
  });
  it("drops a denied snapshot instead of replaying it after a grant", async () => {
    gate(false);
    const { rerender } = renderHook(useAnalyticsSearchResults, {
      initialProps: { ...props, loading: false },
    });
    gate(true);
    rerender({ ...props, loading: false });
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(observations()).toHaveLength(0);
    rerender({ ...props, query: "weather", loading: false });
    await waitFor(() => expect(observations()).toHaveLength(1));
  });
  it.each(["consent", "route"])("cancels the scheduled snapshot across a %s change", (change) => {
    vi.useFakeTimers();
    renderHook(useAnalyticsSearchResults, { initialProps: { ...props, loading: false } });
    if (change === "consent") {
      gate(false);
      gate(true);
    } else {
      tracker.pause();
      tracker.update({ ...page, page_location: "https://clawhub.ai/plugins" }, "/plugins", {
        consentEpoch: epoch,
      });
    }
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(observations()).toHaveLength(0);
  });
});
