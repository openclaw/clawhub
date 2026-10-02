import { useEffect, useRef, useState } from "react";
import {
  ANALYTICS_CHOICE_KEY,
  ANALYTICS_POLICY_VERSION,
  GOOGLE_ANALYTICS_ENABLED,
  analyticsConsentDecision,
  analyticsChoiceEpoch,
  clearGoogleAnalyticsCookies,
  parseAnalyticsRegion,
  readAnalyticsChoice,
  type AnalyticsChoice,
  type AnalyticsRegionClass,
} from "../lib/analyticsConsent";
import { getRuntimeEnv } from "../lib/runtimeEnv";

function publishDecision(allowed: boolean, epoch = "") {
  document.documentElement.dataset.analyticsConsentEpoch = allowed ? epoch : "";
  document.documentElement.dataset.analyticsAllowed = String(allowed);
  window.dispatchEvent(new Event("clawhub:analytics-preference"));
}

export function AnalyticsChoices() {
  const rolloutEnabled = GOOGLE_ANALYTICS_ENABLED || getRuntimeEnv("VITE_GA4_ENABLED") === "1";
  const [region, setRegion] = useState<AnalyticsRegionClass>("unknown");
  const [choice, setChoice] = useState<AnalyticsChoice | null>(null);
  const [choiceEpoch, setChoiceEpoch] = useState("");
  const [invalidChoice, setInvalidChoice] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [privacySignal, setPrivacySignal] = useState(false);
  const noticeShown = false;
  const allowed =
    rolloutEnabled &&
    choice === "granted" &&
    analyticsConsentDecision({
      choice,
      region,
      privacySignal,
      storageError,
      noticeShown,
      invalidChoice,
    });
  const decisionInputs = useRef({ region, storageError, noticeShown });
  decisionInputs.current = { region, storageError, noticeShown };

  useEffect(() => {
    if (!rolloutEnabled) return undefined;
    const refresh = () => {
      const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
      const signal = Boolean(nav.globalPrivacyControl) || nav.doNotTrack === "1";
      setPrivacySignal(signal);
      try {
        const raw = localStorage.getItem(ANALYTICS_CHOICE_KEY);
        const savedChoice = readAnalyticsChoice(raw);
        const savedEpoch = analyticsChoiceEpoch(raw);
        const invalidSavedChoice = raw !== null && savedChoice === null;
        setChoice(savedChoice);
        setChoiceEpoch(savedEpoch);
        setInvalidChoice(invalidSavedChoice);
        const current = decisionInputs.current;
        const allowedNow =
          savedChoice === "granted" &&
          analyticsConsentDecision({
            ...current,
            choice: savedChoice,
            privacySignal: signal,
            invalidChoice: invalidSavedChoice,
          });
        publishDecision(
          allowedNow,
          savedChoice === "granted"
            ? savedEpoch
            : `regional:${ANALYTICS_POLICY_VERSION}:${current.region}`,
        );
      } catch {
        setStorageError(true);
        decisionInputs.current.storageError = true;
        publishDecision(false);
      }
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("clawhub:analytics-refresh", refresh);
    // Read persisted choice synchronously before restored SDK callbacks resume.
    window.addEventListener("pageshow", refresh, true);
    document.addEventListener("resume", refresh, true);
    document.addEventListener("visibilitychange", refresh, true);
    const expiryCheck = window.setInterval(refresh, 60_000);
    let active = true;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 3000);
    void fetch("/api/analytics-consent", { cache: "no-store", signal: abort.signal })
      .then(async (response) =>
        response.ok ? parseAnalyticsRegion(await response.json()) : ("unknown" as const),
      )
      .then((next) => {
        if (active) setRegion(next);
      })
      .catch(() => {
        if (active) setRegion("unknown");
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      active = false;
      abort.abort();
      window.clearTimeout(timeout);
      window.clearInterval(expiryCheck);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("clawhub:analytics-refresh", refresh);
      window.removeEventListener("pageshow", refresh, true);
      document.removeEventListener("resume", refresh, true);
      document.removeEventListener("visibilitychange", refresh, true);
    };
  }, [rolloutEnabled]);

  useEffect(() => {
    if (!choiceEpoch) return undefined;
    const expires = Number(choiceEpoch.split(":").at(-1));
    let timer: number;
    const check = () => {
      const remaining = expires - Date.now();
      if (remaining <= 0) {
        window.dispatchEvent(new Event("clawhub:analytics-refresh"));
        return;
      }
      timer = window.setTimeout(check, Math.min(remaining, 60_000));
    };
    check();
    return () => window.clearTimeout(timer);
  }, [choiceEpoch]);
  useEffect(() => {
    publishDecision(
      allowed,
      choice === "granted" ? choiceEpoch : `regional:${ANALYTICS_POLICY_VERSION}:${region}`,
    );
    if (!allowed && (choice === "denied" || privacySignal || storageError))
      clearGoogleAnalyticsCookies();
  }, [allowed, choice, choiceEpoch, region, privacySignal, storageError]);

  // No notice or toggle: only previously saved explicit grants can permit collection.
  return null;
}
