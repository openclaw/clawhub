export const ANALYTICS_POLICY_VERSION = "2026-10-02.v2";
// Source-owned rollout switch. Change only with the coordinated release GO.
export const GOOGLE_ANALYTICS_ENABLED = true;
export const ANALYTICS_CHOICE_KEY = "clawhub.analytics.choice";
const CHOICE_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
export type AnalyticsRegionClass = "opt_in" | "notice_opt_out" | "unknown";
export type AnalyticsChoice = "granted" | "denied";

export function parseAnalyticsRegion(value: unknown): AnalyticsRegionClass {
  if (!value || typeof value !== "object") return "unknown";
  const payload = value as Record<string, unknown>;
  if (payload.schema_version !== 1 || payload.policy_version !== ANALYTICS_POLICY_VERSION)
    return "unknown";
  return payload.region_class === "opt_in" || payload.region_class === "notice_opt_out"
    ? payload.region_class
    : "unknown";
}

export function readAnalyticsChoice(raw: string | null, now = Date.now()): AnalyticsChoice | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Record<string, unknown>;
    if (
      record.schema_version !== 1 ||
      record.policy_version !== ANALYTICS_POLICY_VERSION ||
      (record.analytics !== "granted" && record.analytics !== "denied")
    )
      return null;
    if (typeof record.updated_at !== "string" || typeof record.expires_at !== "string") return null;
    const updated = Date.parse(record.updated_at);
    const expires = Date.parse(record.expires_at);
    if (
      !Number.isFinite(updated) ||
      !Number.isFinite(expires) ||
      updated > now ||
      expires <= now ||
      expires <= updated ||
      expires - updated > CHOICE_LIFETIME_MS
    )
      return null;
    return record.analytics;
  } catch {
    return null;
  }
}

export function makeAnalyticsChoice(choice: AnalyticsChoice, now = Date.now()) {
  return JSON.stringify({
    schema_version: 1,
    policy_version: ANALYTICS_POLICY_VERSION,
    analytics: choice,
    updated_at: new Date(now).toISOString(),
    expires_at: new Date(now + CHOICE_LIFETIME_MS).toISOString(),
  });
}

export function analyticsChoiceEpoch(raw: string | null, now = Date.now()) {
  const choice = readAnalyticsChoice(raw, now);
  if (!choice || !raw) return "";
  const record = JSON.parse(raw) as { updated_at: string; expires_at: string };
  return `${ANALYTICS_POLICY_VERSION}:${choice}:${Date.parse(record.updated_at)}:${Date.parse(record.expires_at)}`;
}

export function analyticsConsentDecision({
  choice,
  region,
  privacySignal,
  storageError,
  noticeShown,
  invalidChoice = false,
}: {
  choice: AnalyticsChoice | null;
  region: AnalyticsRegionClass;
  privacySignal: boolean;
  storageError: boolean;
  noticeShown: boolean;
  invalidChoice?: boolean;
}) {
  if (privacySignal || storageError || invalidChoice || choice === "denied") return false;
  return choice === "granted" || (region === "notice_opt_out" && noticeShown);
}

export function clearGoogleAnalyticsCookies() {
  for (const name of ["_ga", "_ga_3SK7X2YLSJ"]) {
    for (const domain of ["", "; Domain=clawhub.ai", "; Domain=.clawhub.ai"]) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure${domain}`;
    }
  }
}

export function hasInitialAnalyticsGrant(documentStart = performance.timeOrigin) {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    const raw = localStorage.getItem(ANALYTICS_CHOICE_KEY);
    if (!raw || readAnalyticsChoice(raw) !== "granted") return false;
    const updated = Date.parse((JSON.parse(raw) as { updated_at: string }).updated_at);
    return (
      !nav.globalPrivacyControl &&
      nav.doNotTrack !== "1" &&
      Number.isFinite(documentStart) &&
      updated <= documentStart
    );
  } catch {
    return false;
  }
}
