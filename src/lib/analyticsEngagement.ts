import { onCLS, onINP, onLCP, type Metric } from "web-vitals";
import type { AnalyticsEvent } from "./analyticsEvents";

const SECTIONS = {
  catalog: ".results-list, .skills-results, .search-results-sections",
  install: ".skill-install-surface, .skill-install-command-card",
  readme: "#skill-tabpanel-readme",
  security: ".detail-security-summary, .skills-sh-security-audits",
  footer: "footer",
} as const;

export function observeAnalyticsEngagement(
  send: (event: AnalyticsEvent) => void,
  canCollect: () => boolean = () => true,
) {
  const depths = new Set<number>();
  let activeSeconds = 0;
  const readingMilestones = new Set<number>();
  const scroll = () => {
    if (!canCollect() || document.visibilityState !== "visible") return;
    const available = document.documentElement.scrollHeight - window.innerHeight;
    if (available <= 0) return;
    const percent = Math.min(100, (window.scrollY / available) * 100);
    for (const depth of [25, 50, 75] as const) {
      if (percent >= depth && !depths.has(depth)) {
        depths.add(depth);
        send({ name: "scroll_depth", params: { percent_scrolled: depth } });
      }
    }
  };
  window.addEventListener("scroll", scroll, { passive: true });
  const readTimer = window.setInterval(() => {
    if (!canCollect() || document.visibilityState !== "visible") return;
    activeSeconds++;
    for (const threshold of [30, 60] as const) {
      if (activeSeconds >= threshold && depths.has(25) && !readingMilestones.has(threshold)) {
        readingMilestones.add(threshold);
        send({ name: "content_engagement", params: { engagement_seconds: threshold } });
      }
    }
  }, 1000);

  const seen = new Set<string>();
  const timers = new Map<Element, number>();
  const sectionIds = new Map<Element, keyof typeof SECTIONS>();
  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const section = sectionIds.get(entry.target);
              if (!section || seen.has(section)) continue;
              const timer = timers.get(entry.target);
              if (timer) window.clearTimeout(timer);
              timers.delete(entry.target);
              if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
                timers.set(
                  entry.target,
                  window.setTimeout(() => {
                    if (
                      !canCollect() ||
                      document.visibilityState !== "visible" ||
                      seen.has(section)
                    )
                      return;
                    seen.add(section);
                    send({ name: "section_view", params: { section_id: section } });
                  }, 1000),
                );
              }
            }
          },
          { threshold: 0.5 },
        );
  const observeSections = () => {
    for (const [id, selector] of Object.entries(SECTIONS)) {
      for (const element of document.querySelectorAll(selector)) {
        if (sectionIds.has(element)) continue;
        sectionIds.set(element, id as keyof typeof SECTIONS);
        observer?.observe(element);
      }
    }
  };
  observeSections();
  const delayedSections = window.setTimeout(observeSections, 1500);
  return () => {
    window.removeEventListener("scroll", scroll);
    window.clearInterval(readTimer);
    window.clearTimeout(delayedSections);
    observer?.disconnect();
    timers.forEach((timer) => window.clearTimeout(timer));
  };
}

export function observeAnalyticsPerformance(
  send: (event: AnalyticsEvent) => void,
  release: string,
  { eligibleSince, isEligible }: { eligibleSince: number; isEligible: () => boolean },
) {
  let active = true;
  const report = (metric: Metric) => {
    if (
      !active ||
      !isEligible() ||
      (eligibleSince > 0 && metric.entries.length === 0) ||
      metric.entries.some(
        (entry) => !Number.isFinite(entry.startTime) || entry.startTime < eligibleSince,
      ) ||
      !["LCP", "INP", "CLS"].includes(metric.name)
    )
      return;
    send({
      name: "web_vital",
      params: {
        metric_name: metric.name as "LCP" | "INP" | "CLS",
        ...(metric.name === "LCP"
          ? { lcp_ms: metric.value }
          : metric.name === "INP"
            ? { inp_ms: metric.value }
            : { cls_score: metric.value }),
        metric_rating: metric.rating,
        navigation_type: metric.navigationType,
        release,
      },
    });
  };
  onCLS(report, { reportSoftNavs: false });
  onINP(report, { reportSoftNavs: false });
  onLCP(report, { reportSoftNavs: false });
  return () => {
    active = false;
  };
}

export function observeAnalyticsErrors(send: (event: AnalyticsEvent) => void, release: string) {
  const runtimeError = () =>
    send({
      name: "client_error",
      params: { error_type: "runtime", error_code: "uncaught", release },
    });
  const rejection = () =>
    send({
      name: "client_error",
      params: { error_type: "promise", error_code: "unhandled_rejection", release },
    });
  window.addEventListener("error", runtimeError);
  window.addEventListener("unhandledrejection", rejection);
  return () => {
    window.removeEventListener("error", runtimeError);
    window.removeEventListener("unhandledrejection", rejection);
  };
}
