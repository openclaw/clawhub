// Retained regional metadata endpoint version; it does not gate analytics startup.
export const ANALYTICS_POLICY_VERSION = "2026-10-02.v2";
// Source-owned rollout switch. Change only with the coordinated release GO.
export const GOOGLE_ANALYTICS_ENABLED = true;
export type AnalyticsRegionClass = "opt_in" | "notice_opt_out" | "unknown";

export function hasAnalyticsPrivacySignal(browser: Window = window) {
  const nav = browser.navigator as Navigator & { globalPrivacyControl?: boolean };
  return Boolean(nav.globalPrivacyControl) || nav.doNotTrack === "1";
}

export function clearGoogleAnalyticsCookies() {
  for (const name of ["_ga", "_ga_3SK7X2YLSJ"]) {
    for (const domain of ["", "; Domain=clawhub.ai", "; Domain=.clawhub.ai"]) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure${domain}`;
    }
  }
}
