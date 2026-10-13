import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Metric } from "web-vitals";
import {
  observeAnalyticsEngagement,
  observeAnalyticsErrors,
  observeAnalyticsPerformance,
} from "./analyticsEngagement";

const callbacks = vi.hoisted(() => new Map<string, (metric: Metric) => void>());
vi.mock("web-vitals", () => ({
  onLCP: (callback: (metric: Metric) => void) => callbacks.set("LCP", callback),
  onINP: (callback: (metric: Metric) => void) => callbacks.set("INP", callback),
  onCLS: (callback: (metric: Metric) => void) => callbacks.set("CLS", callback),
}));
afterEach(() => callbacks.clear());
function metric(name: "LCP" | "INP" | "CLS", times: number[]): Metric {
  return {
    name,
    value: name === "CLS" ? 0.03 : 140,
    delta: 1,
    rating: "good",
    id: "not-exported",
    navigationId: 0,
    navigationType: "navigate",
    entries: times.map(
      (startTime) => ({ startTime, name: "not-exported-private-entry" }) as PerformanceEntry,
    ),
  };
}

describe("consent-bound document Web Vitals", () => {
  it("rejects buffered pre-choice entries and keeps valid later measurements", () => {
    const send = vi.fn();
    observeAnalyticsPerformance(send, "abcdef123", { eligibleSince: 100, isEligible: () => true });
    callbacks.get("LCP")!(metric("LCP", [99]));
    callbacks.get("INP")!(metric("INP", [99, 150]));
    callbacks.get("CLS")!(metric("CLS", []));
    expect(send).not.toHaveBeenCalled();
    callbacks.get("LCP")!(metric("LCP", [101]));
    expect(send).toHaveBeenCalledWith({
      name: "web_vital",
      params: {
        metric_name: "LCP",
        lcp_ms: 140,
        metric_rating: "good",
        navigation_type: "navigate",
        release: "abcdef123",
      },
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain("private-entry");
  });
  it("permits initial buffered metrics only for an initially valid explicit grant", () => {
    const send = vi.fn();
    observeAnalyticsPerformance(send, "abcdef123", { eligibleSince: 0, isEligible: () => true });
    callbacks.get("INP")!(metric("INP", [1]));
    callbacks.get("CLS")!(metric("CLS", []));
    expect(send.mock.calls[0][0].params).toMatchObject({ inp_ms: 140 });
    expect(send.mock.calls[0][0].params).not.toHaveProperty("lcp_ms");
    expect(send.mock.calls[1][0].params).toMatchObject({ cls_score: 0.03 });
    expect(send.mock.calls[1][0].params).not.toHaveProperty("metric_value");
  });
  it("never replays delayed callbacks after document revocation, even on regrant", () => {
    const send = vi.fn();
    let eligible = true;
    const stop = observeAnalyticsPerformance(send, "abcdef123", {
      eligibleSince: 0,
      isEligible: () => eligible,
    });
    callbacks.get("LCP")!(metric("LCP", [1]));
    eligible = false;
    stop();
    callbacks.get("INP")!(metric("INP", [10]));
    eligible = true;
    callbacks.get("CLS")!(metric("CLS", [20]));
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// Real timers are replaced only to exercise the public visibility/dwell contract.
describe("bounded public engagement", () => {
  let intersection: (entries: Array<Partial<IntersectionObserverEntry>>) => void;
  const observed = new Set<Element>();
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    observed.clear();
    document.body.innerHTML = '<section class="results-list"></section><footer></footer>';
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2000);
    vi.stubGlobal("innerHeight", 1000);
    vi.stubGlobal("scrollY", 0);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof intersection) {
          intersection = callback;
        }
        observe(element: Element) {
          observed.add(element);
        }
        disconnect() {
          observed.clear();
        }
      },
    );
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("counts only allowed visible scroll milestones, each once, excluding native 90", () => {
    const send = vi.fn();
    let allowed = false;
    stop = observeAnalyticsEngagement(send, () => allowed);
    vi.stubGlobal("scrollY", 800);
    window.dispatchEvent(new Event("scroll"));
    expect(send).not.toHaveBeenCalled();
    allowed = true;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    window.dispatchEvent(new Event("scroll"));
    expect(send).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(1000);
    window.dispatchEvent(new Event("scroll"));
    expect(send).not.toHaveBeenCalled();
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2000);
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scroll"));
    expect(send.mock.calls.map(([event]) => event.params.percent_scrolled)).toEqual([25, 50, 75]);
  });
  it("accumulates only visible allowed seconds and requires meaningful scrolling", () => {
    const send = vi.fn();
    let allowed = false;
    stop = observeAnalyticsEngagement(send, () => allowed);
    vi.advanceTimersByTime(30_000);
    expect(send).not.toHaveBeenCalled();
    allowed = true;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.advanceTimersByTime(30_000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.advanceTimersByTime(30_000);
    expect(send).not.toHaveBeenCalled();
    vi.stubGlobal("scrollY", 250);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(30_000);
    expect(
      send.mock.calls
        .filter(([e]) => e.name === "content_engagement")
        .map(([e]) => e.params.engagement_seconds),
    ).toEqual([30, 60]);
    vi.advanceTimersByTime(10_000);
    expect(send.mock.calls.filter(([e]) => e.name === "content_engagement")).toHaveLength(2);
  });
  it("cancels short section appearances and denies pending/hidden dwell", () => {
    const send = vi.fn();
    let allowed = true;
    stop = observeAnalyticsEngagement(send, () => allowed);
    const target = document.querySelector(".results-list")!;
    intersection([{ target, isIntersecting: true, intersectionRatio: 0.4 }]);
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
    intersection([{ target, isIntersecting: true, intersectionRatio: 0.5 }]);
    vi.advanceTimersByTime(500);
    intersection([{ target, isIntersecting: false, intersectionRatio: 0 }]);
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
    intersection([{ target, isIntersecting: true, intersectionRatio: 1 }]);
    allowed = false;
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
    allowed = true;
    intersection([{ target, isIntersecting: true, intersectionRatio: 1 }]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    intersection([{ target, isIntersecting: true, intersectionRatio: 1 }]);
    vi.advanceTimersByTime(1000);
    intersection([
      { target, isIntersecting: true, intersectionRatio: 1 },
      { target: document.createElement("div"), isIntersecting: true, intersectionRatio: 1 },
    ]);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      name: "section_view",
      params: { section_id: "catalog" },
    });
  });
  it("observes late sections and stops pending callbacks on lifecycle cleanup", () => {
    const send = vi.fn();
    stop = observeAnalyticsEngagement(send);
    document.body.insertAdjacentHTML(
      "beforeend",
      '<section class="skill-install-surface"></section>',
    );
    vi.advanceTimersByTime(1500);
    expect(observed.size).toBe(3);
    const target = document.querySelector("footer")!;
    intersection([{ target, isIntersecting: true, intersectionRatio: 1 }]);
    stop();
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event("scroll"));
    expect(send).not.toHaveBeenCalled();
  });
  it("works without IntersectionObserver and strips error contents", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const send = vi.fn();
    stop = observeAnalyticsEngagement(send);
    const clearErrors = observeAnalyticsErrors(send, "abcdef123");
    window.dispatchEvent(new ErrorEvent("error", { message: "private message" }));
    window.dispatchEvent(new Event("unhandledrejection"));
    clearErrors();
    window.dispatchEvent(new Event("error"));
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(send.mock.calls)).not.toContain("private message");
  });
});
