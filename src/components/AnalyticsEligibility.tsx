import { useEffect } from "react";
import {
  GOOGLE_ANALYTICS_ENABLED,
  clearGoogleAnalyticsCookies,
  hasAnalyticsPrivacySignal,
} from "../lib/analyticsConsent";
import { getRuntimeEnv } from "../lib/runtimeEnv";

let generation = 0;

export function AnalyticsEligibility() {
  const enabled = GOOGLE_ANALYTICS_ENABLED || getRuntimeEnv("VITE_GA4_ENABLED") === "1";
  useEffect(() => {
    let previous: boolean | undefined;
    let epoch = "";
    const refresh = () => {
      const allowed = enabled && !hasAnalyticsPrivacySignal();
      if (allowed !== previous) {
        // A fresh in-memory generation prevents replay across a privacy-signal
        // interval. No saved choice or geography participates in eligibility.
        epoch = allowed ? `automatic-public:${++generation}` : "";
        previous = allowed;
      }
      document.documentElement.dataset.analyticsConsentEpoch = epoch;
      document.documentElement.dataset.analyticsAllowed = String(allowed);
      window.dispatchEvent(new Event("clawhub:analytics-preference"));
      if (!allowed) clearGoogleAnalyticsCookies();
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("clawhub:analytics-refresh", refresh);
    // Refresh browser signals synchronously before cached native callbacks resume.
    window.addEventListener("pageshow", refresh, true);
    document.addEventListener("resume", refresh, true);
    document.addEventListener("visibilitychange", refresh, true);
    const signalCheck = window.setInterval(refresh, 60_000);
    return () => {
      window.clearInterval(signalCheck);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("clawhub:analytics-refresh", refresh);
      window.removeEventListener("pageshow", refresh, true);
      document.removeEventListener("resume", refresh, true);
      document.removeEventListener("visibilitychange", refresh, true);
    };
  }, [enabled]);
  return null;
}
