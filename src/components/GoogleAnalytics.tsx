import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { hasAnalyticsPrivacySignal } from "../lib/analyticsConsent";
import {
  observeAnalyticsEngagement,
  observeAnalyticsErrors,
  observeAnalyticsPerformance,
} from "../lib/analyticsEngagement";
import {
  ANALYTICS_EVENT,
  analyticsExternalLinkParameters,
  analyticsPublicResourcePlacement,
  analyticsPreferenceAllowsCollection,
  captureAnalyticsOperation,
  isSensitiveAnalyticsDestination,
  normalizeNonfunctionalSearchKeys,
  registerAnalyticsOperations,
  type AnalyticsEvent,
  type AnalyticsOperation,
} from "../lib/analyticsEvents";
import { analyticsReleaseFromModuleUrl } from "../lib/analyticsRelease";
import { createGoogleAnalytics, getGoogleAnalyticsPage } from "../lib/googleAnalytics";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { useAuthStatus } from "../lib/useAuthStatus";

const analyticsRelease = analyticsReleaseFromModuleUrl(import.meta.url);

export function GoogleAnalytics() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStatus();
  const analytics = useRef<ReturnType<typeof createGoogleAnalytics> | null>(null);
  const observedPath = useRef<string | null>(null);
  const stopEngagement = useRef<(() => void) | null>(null);
  const loginPending = useRef<{ operation: AnalyticsOperation; capturedAt: number } | null>(null);
  const restorePending = useRef(false);
  const pageHidden = useRef(false);
  const sensitiveDeparture = useRef<string | null>(null);
  const resourceVisibility = useRef<{ id: string; public: boolean } | null>(null);
  const performanceState = useRef<{
    initialPath: string;
    initiallyAllowed: boolean;
    eligible: boolean;
    started: boolean;
    stop?: () => void;
    restoredPage?: NonNullable<ReturnType<typeof getGoogleAnalyticsPage>>;
  } | null>(null);
  performanceState.current ??= {
    initialPath: window.location.pathname,
    initiallyAllowed: !hasAnalyticsPrivacySignal(),
    eligible: true,
    started: false,
  };

  useEffect(() => {
    analytics.current ??= createGoogleAnalytics(router.options.ssr?.nonce ?? "");
    const tracker = analytics.current;
    const unregisterOperations = registerAnalyticsOperations((workflow) => {
      if (workflow === "skill_publish" && window.location.pathname !== "/skills/publish")
        return null;
      if (workflow === "plugin_publish" && window.location.pathname !== "/plugins/publish")
        return null;
      return tracker.captureOperation(workflow);
    });
    const publicRouteContext = (ignoreQuery = false) =>
      getGoogleAnalyticsPage({
        href: ignoreQuery
          ? `${window.location.origin}${window.location.pathname}`
          : window.location.href,
        deployment: getRuntimeEnv("VITE_CLAWHUB_DEPLOY_ENV"),
        isAuthenticated,
        isLoading: router.state.isLoading,
        matches: router.state.matches,
        collectionAllowed: true,
      });
    const update = () => {
      const collectionAllowed = analyticsPreferenceAllowsCollection();
      const consentEpoch = document.documentElement.dataset.analyticsConsentEpoch ?? "";
      if (
        collectionAllowed &&
        !pageHidden.current &&
        !router.state.isLoading &&
        router.state.status === "idle"
      ) {
        const normalized = normalizeNonfunctionalSearchKeys(window.location.href);
        if (
          normalized !== window.location.href &&
          getGoogleAnalyticsPage({
            href: normalized,
            deployment: getRuntimeEnv("VITE_CLAWHUB_DEPLOY_ENV"),
            isAuthenticated,
            isLoading: false,
            matches: router.state.matches,
          })
        ) {
          window.history.replaceState(window.history.state, "", normalized);
        }
      }
      if (!collectionAllowed) {
        loginPending.current = null;
        tracker.optOut();
        if (performanceState.current?.started) {
          performanceState.current.eligible = false;
          performanceState.current.stop?.();
        }
      }
      if (
        loginPending.current &&
        (!loginPending.current.operation.isValid() ||
          Date.now() - loginPending.current.capturedAt > 30_000 ||
          Date.now() < loginPending.current.capturedAt)
      )
        loginPending.current = null;
      let page = getGoogleAnalyticsPage({
        href: window.location.href,
        deployment: getRuntimeEnv("VITE_CLAWHUB_DEPLOY_ENV"),
        isAuthenticated,
        isLoading: isLoading || router.state.isLoading || pageHidden.current,
        matches: router.state.matches,
        referrer: document.referrer,
        collectionAllowed:
          collectionAllowed && sensitiveDeparture.current !== window.location.pathname,
      });
      const resourceBlocked = Boolean(
        page?.content_id &&
        resourceVisibility.current?.id === page.content_id &&
        !resourceVisibility.current.public,
      );
      if (resourceBlocked) page = null;
      tracker.update(page, window.location.pathname, {
        navigationPending: router.state.isLoading || router.state.status !== "idle",
        collectionAllowed,
        consentEpoch,
      });
      const vitals = performanceState.current!;
      if (restorePending.current) {
        if (page) vitals.restoredPage = page;
        restorePending.current = false;
      }
      if (
        router.state.status === "idle" &&
        !page &&
        collectionAllowed &&
        !pageHidden.current &&
        (vitals.started || !publicRouteContext() || resourceBlocked)
      ) {
        // Never report a document aggregate that spans a private/unknown route.
        vitals.eligible = false;
        vitals.stop?.();
      }
      if (page && router.state.status === "idle" && vitals.eligible && !vitals.started) {
        if (window.location.pathname !== vitals.initialPath) {
          vitals.eligible = false;
        } else {
          vitals.started = true;
          vitals.stop = observeAnalyticsPerformance(
            (event) =>
              tracker.trackDocumentVital(
                event,
                event.name === "web_vital" && event.params.navigation_type === "back-forward-cache"
                  ? (vitals.restoredPage ?? page)
                  : page,
              ),
            analyticsRelease,
            {
              eligibleSince: vitals.initiallyAllowed ? 0 : performance.now(),
              isEligible: () =>
                vitals.eligible && analyticsPreferenceAllowsCollection() && tracker.isActive(),
            },
          );
        }
      }
      if (isAuthenticated && !isLoading && loginPending.current) {
        const { operation } = loginPending.current;
        loginPending.current = null;
        operation.emit("login", { method: "github" });
      }
      if (!page && router.state.status === "idle") {
        stopEngagement.current?.();
        stopEngagement.current = null;
        observedPath.current = null;
      } else if (
        page &&
        router.state.status === "idle" &&
        observedPath.current !== window.location.pathname
      ) {
        stopEngagement.current?.();
        observedPath.current = window.location.pathname;
        stopEngagement.current = observeAnalyticsEngagement(
          (event) => tracker.track(event),
          () => analyticsPreferenceAllowsCollection() && tracker.isActive(),
        );
      }
    };
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<AnalyticsEvent & { pathname: string }>).detail;
      if (detail.pathname === window.location.pathname && analyticsPreferenceAllowsCollection())
        tracker.track(detail);
    };
    const onClick = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }
      if (
        url.origin !== window.location.origin &&
        isSensitiveAnalyticsDestination(anchor.href, window.location.origin)
      ) {
        // The SDK must not inspect credential-bearing outbound destinations. Keep
        // this view paused until navigation, rather than guessing an SDK send delay.
        sensitiveDeparture.current = window.location.pathname;
        tracker.pause();
        return;
      }
      if (url.origin !== window.location.origin) {
        const placement = analyticsPublicResourcePlacement(anchor);
        if (placement && tracker.isActive() && analyticsPreferenceAllowsCollection()) {
          tracker.track({
            name: "select_content",
            params: {
              content_type: "resource",
              content_id: `${placement}_link`,
              ui_location: placement,
              ...analyticsExternalLinkParameters(anchor, window.location.origin),
            },
          });
        }
        return;
      }
      if (
        url.origin === window.location.origin &&
        ["/", "/skills", "/plugins", "/publishers", "/official", "/audits", "/search"].includes(
          url.pathname,
        )
      ) {
        tracker.track({
          name: "select_content",
          params: {
            content_type: "navigation",
            content_id: url.pathname,
            ui_location: anchor.closest("footer")
              ? "footer"
              : anchor.closest("header")
                ? "header"
                : "catalog",
          },
        });
      }
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(ANALYTICS_EVENT, onEvent);
    const visibilityChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; public: boolean }>).detail;
      if (publicRouteContext(true)?.content_id !== detail.id) return;
      resourceVisibility.current = detail;
      if (!detail.public) tracker.pause();
      update();
    };
    window.addEventListener("clawhub:analytics-resource-visibility", visibilityChanged);
    const loginAcknowledged = () => {
      // The authoritative ACK is the approved login capture boundary. Its token
      // must remain valid while waiting for resolved authentication.
      const operation = captureAnalyticsOperation("authentication");
      loginPending.current = operation?.isValid()
        ? {
            operation,
            capturedAt: Date.now(),
          }
        : null;
      update();
    };
    window.addEventListener("clawhub:login-acknowledged", loginAcknowledged);
    window.addEventListener("clawhub:analytics-preference", update);

    // Pause before a new route loads, including transitions whose visibility is still unknown.
    const beforeNavigate = router.subscribe("onBeforeNavigate", tracker.pause);
    const beforeLoad = router.subscribe("onBeforeLoad", tracker.pause);
    const resolved = router.subscribe("onResolved", () => {
      if (sensitiveDeparture.current !== window.location.pathname)
        sensitiveDeparture.current = null;
      update();
    });
    const restored = (event: PageTransitionEvent) => {
      if (!event.isTrusted) return;
      pageHidden.current = false;
      if (!event.persisted) return;
      tracker.pause();
      tracker.restoreNavigation();
      stopEngagement.current?.();
      observedPath.current = null;
      restorePending.current = true;
      window.dispatchEvent(new Event("clawhub:analytics-refresh"));
      update();
    };
    const cached = (event: PageTransitionEvent) => {
      pageHidden.current = true;
      if (event.persisted) tracker.cacheNavigation(window.location.pathname);
    };
    window.addEventListener("pagehide", cached, true);
    window.addEventListener("pageshow", restored, true);
    update();
    return () => {
      unregisterOperations();
      beforeNavigate();
      beforeLoad();
      resolved();
      tracker.pause();
      window.removeEventListener(ANALYTICS_EVENT, onEvent);
      window.removeEventListener("clawhub:analytics-resource-visibility", visibilityChanged);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("clawhub:login-acknowledged", loginAcknowledged);
      window.removeEventListener("clawhub:analytics-preference", update);
      window.removeEventListener("pageshow", restored, true);
      window.removeEventListener("pagehide", cached, true);
    };
  }, [router, isAuthenticated, isLoading]);

  useEffect(() => {
    return observeAnalyticsErrors((event) => {
      if (analyticsPreferenceAllowsCollection()) analytics.current?.track(event);
    }, analyticsRelease);
  }, []);

  useEffect(
    () => () => {
      stopEngagement.current?.();
      stopEngagement.current = null;
      observedPath.current = null;
    },
    [],
  );

  return null;
}
