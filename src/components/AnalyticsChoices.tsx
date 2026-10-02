import { useEffect, useRef, useState } from "react";
import {
  ANALYTICS_CHOICE_KEY,
  ANALYTICS_POLICY_VERSION,
  GOOGLE_ANALYTICS_ENABLED,
  analyticsConsentDecision,
  analyticsChoiceEpoch,
  clearGoogleAnalyticsCookies,
  makeAnalyticsChoice,
  parseAnalyticsRegion,
  readAnalyticsChoice,
  type AnalyticsChoice,
  type AnalyticsRegionClass,
} from "../lib/analyticsConsent";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { Button } from "./ui/button";

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
  const [resolved, setResolved] = useState(false);
  const [open, setOpen] = useState(false);
  const [noticeShown, setNoticeShown] = useState(false);
  const regionalNotice =
    !choice && !invalidChoice && !storageError && !privacySignal && region === "notice_opt_out";
  const control = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const allowed =
    rolloutEnabled &&
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
        const allowedNow = analyticsConsentDecision({
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
        if (active) setResolved(true);
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
    if (resolved && !choice) setOpen(true);
  }, [resolved, choice]);
  useEffect(() => {
    if (resolved && regionalNotice && !noticeShown) setOpen(true);
  }, [resolved, regionalNotice, noticeShown]);
  useEffect(() => {
    // Permission/privacy-signal panels are not the regional default-on notice.
    if (open && resolved && regionalNotice) setNoticeShown(true);
  }, [open, resolved, regionalNotice]);
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

  function choose(next: AnalyticsChoice) {
    // Close the transport gate synchronously on decline, before React commits.
    if (next === "denied") {
      publishDecision(false);
    }
    try {
      const raw = makeAnalyticsChoice(next);
      localStorage.setItem(ANALYTICS_CHOICE_KEY, raw);
      setChoice(next);
      setChoiceEpoch(analyticsChoiceEpoch(raw));
      setInvalidChoice(false);
      setStorageError(false);
      decisionInputs.current.storageError = false;
      setOpen(false);
      restoreFocus();
    } catch {
      setStorageError(true);
      decisionInputs.current.storageError = true;
      publishDecision(false);
    }
  }

  function restoreFocus() {
    const previous = opener.current;
    opener.current = null;
    previous?.focus({ preventScroll: true });
  }

  if (!rolloutEnabled) return null;
  return (
    <>
      <Button
        ref={control}
        type="button"
        variant="link"
        size="sm"
        onClick={() => {
          opener.current = control.current;
          setOpen(true);
          window.setTimeout(() => heading.current?.focus({ preventScroll: true }), 0);
        }}
      >
        Google Analytics choices
      </Button>
      {open ? (
        <section
          aria-labelledby="analytics-choices-heading"
          className="fixed bottom-4 right-4 z-50 max-h-[80vh] w-[min(28rem,calc(100vw-2rem))] overflow-auto rounded-[var(--oc-radius-surface)] border border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-bg-elevated)] p-5 text-[color:var(--oc-text-primary)] shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              restoreFocus();
            }
          }}
        >
          <h2
            ref={heading}
            tabIndex={-1}
            id="analytics-choices-heading"
            className="mb-2 font-semibold"
          >
            {regionalNotice ? "Google Analytics on this site" : "Optional Google Analytics"}
          </h2>
          <p className="text-sm">
            {regionalNotice
              ? "Google Analytics is on to help us understand page visits, interactions, and performance. We do not use it for advertising. You can turn it off or change your choice anytime."
              : "With your permission, we use Google Analytics to understand page visits, interactions, and performance on this site. We do not use it for advertising. You can change your choice anytime."}
          </p>
          <p className="mt-3 text-sm">
            This choice controls Google Analytics only. Existing Vercel analytics and basic server
            traffic counts continue separately.
          </p>
          <p role="status" className="mt-3 text-sm">
            {privacySignal
              ? "Google Analytics is off because your browser sends a privacy signal."
              : storageError
                ? "Google Analytics is off in this tab, but your choice could not be saved. It may not carry over to another tab or visit."
                : `Google Analytics is ${allowed ? "on" : "off"}.`}
          </p>
          {!privacySignal ? (
            <div className="my-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => choose("granted")}>
                {regionalNotice ? "Keep Google Analytics on" : "Allow Google Analytics"}
              </Button>
              <Button type="button" variant="outline" onClick={() => choose("denied")}>
                {regionalNotice ? "Turn Google Analytics off" : "Decline Google Analytics"}
              </Button>
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-3">
            <details className="text-sm">
              <summary className="cursor-pointer underline">Privacy details</summary>
              <p className="mt-2">
                When enabled, Google Analytics receives information about page visits, public
                content and link metadata, selected interactions, supported public searches, and
                performance. Public search terms are filtered before collection. Other typed form
                contents, private messages, and visitor account identity are not sent. Analytics
                cookies may recognize return visits. We do not use this setup for advertising. Your
                browser privacy signal and saved choice control Google Analytics collection. Your
                choice is saved separately on each site for up to 180 days.
              </p>
              <p className="mt-2">
                Turning Google Analytics off stops new Google Analytics collection on this site.
                Events already collected while it was allowed may finish sending, and information
                already sent is not recalled. A saved change also applies to other open tabs on this
                same site.
              </p>
              <p className="mt-2">
                Google Analytics is configured to retain event-level data used for explorations for
                14 months. User-associated data is configured for 14 months, with its retention
                timer reset by new activity. Most standard aggregate reports follow separate
                retention rules. These settings do not change how long this site saves your Google
                Analytics choice, which is up to 180 days.
              </p>
            </details>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                restoreFocus();
              }}
            >
              Close
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
