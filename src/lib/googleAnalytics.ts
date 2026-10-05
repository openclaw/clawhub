import {
  analyticsEventParameters,
  isSafeNativeSearchContext,
  publicAnalyticsContentId,
  safePublicSearchTerm,
  safeReferralOrigin,
  type AnalyticsEvent,
  type AnalyticsWorkflow,
} from "./analyticsEvents";

export const GOOGLE_ANALYTICS_ID = "G-3SK7X2YLSJ";
const PUBLIC_ORIGIN = "https://clawhub.ai";

type AnalyticsMatch = {
  routeId: string;
  status: string;
  loaderData?: unknown;
  globalNotFound?: boolean;
};

type PublicPage = {
  page_location: string;
  page_title: string;
  page_referrer: string;
  content_id?: string;
  content_type?: string;
  ui_location?: "skill_publish" | "plugin_publish" | "authentication";
};

const PUBLIC_PAGES: Record<string, [string, string]> = {
  "/": ["/", "ClawHub"],
  "/skills/": ["/skills", "Skills - ClawHub"],
  "/plugins/": ["/plugins", "Plugins - ClawHub"],
  "/publishers/": ["/publishers", "Publishers - ClawHub"],
  "/official/": ["/official", "Official publishers - ClawHub"],
  "/audits": ["/audits", "Security audits - ClawHub"],
  "/search": ["/search", "Search - ClawHub"],
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function isPublicAnalyticsSkill(value: unknown) {
  const result = record(value);
  const skill = record(result.skill);
  const moderation = record(result.moderationInfo);
  return Boolean(
    result.skill &&
    (result.latestVersion || skill.installKind === "github") &&
    !skill.softDeletedAt &&
    (!skill.moderationStatus || skill.moderationStatus === "active") &&
    !result.pendingReview &&
    !moderation.isPendingScan &&
    !moderation.isHiddenByMod &&
    !moderation.isRemoved &&
    !moderation.isMalwareBlocked,
  );
}

export function getGoogleAnalyticsPage({
  href,
  deployment,
  isLoading,
  matches,
  referrer = "",
  collectionAllowed = true,
}: {
  href: string;
  deployment: string | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
  matches: AnalyticsMatch[];
  referrer?: string;
  collectionAllowed?: boolean;
}): PublicPage | null {
  if (deployment !== "production" || isLoading || !collectionAllowed) return null;
  const url = new URL(href);
  if (url.origin !== PUBLIC_ORIGIN) return null;
  if (
    ["code", "token", "state", "return_to", "auth_retry", "error_description"].some((key) =>
      url.searchParams.has(key),
    )
  )
    return null;
  const query = url.searchParams.get("q");
  if (!isSafeNativeSearchContext(url)) return null;
  if (
    !matches.length ||
    matches.some((match) => match.status !== "success" || match.globalNotFound)
  ) {
    return null;
  }
  const match = matches[matches.length - 1];
  let page = PUBLIC_PAGES[match.routeId];
  let content: Pick<PublicPage, "content_id" | "content_type"> = {};
  const data = record(match.loaderData);
  // These loaders use unauthenticated public APIs. Authentication alone does not
  // make a publicly resolved resource private; moderation/visibility still gates it.
  if (match.routeId === "/$owner/skills/$slug") {
    const result = record(record(data.initialData).result);
    if (isPublicAnalyticsSkill(result)) {
      page = [url.pathname, "Skill - ClawHub"];
      const id = record(result.skill)._id;
      if (typeof id === "string") {
        content = { content_id: publicAnalyticsContentId("skill", id), content_type: "skill" };
      }
    }
  }
  if (match.routeId === "/$owner/plugins/$slug") {
    const pkg = record(record(data.detail).package);
    if (pkg.channel === "official" || pkg.channel === "community") {
      page = [url.pathname, "Plugin - ClawHub"];
      if (typeof pkg.name === "string") {
        content = {
          content_id: publicAnalyticsContentId("plugin", pkg.name),
          content_type: "plugin",
        };
      }
    }
  }
  if (match.routeId === "/skills-sh/$owner/$repo/$slug" && match.loaderData) {
    page = [url.pathname, "Catalog skill - ClawHub"];
    if (typeof data.externalId === "string") {
      content = {
        content_id: publicAnalyticsContentId("catalog_skill", data.externalId),
        content_type: "catalog_skill",
      };
    }
  }
  const attribution = new URLSearchParams();
  if (query && ["/search", "/skills", "/plugins"].includes(url.pathname.replace(/\/$/, ""))) {
    attribution.set("q", query.trim().replace(/\s+/g, " "));
  }
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const value = safePublicSearchTerm(url.searchParams.get(key));
    if (value) attribution.set(key, value);
  }
  // Never derive analytics fields from the document title, user content, or URL parameters.
  return page
    ? {
        page_location: `${PUBLIC_ORIGIN}${page[0]}${attribution.size ? `?${attribution}` : ""}`,
        page_title: page[1],
        page_referrer: safeReferralOrigin(referrer),
        ...content,
      }
    : null;
}

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  "ga-disable-G-3SK7X2YLSJ"?: boolean;
};

function deferredWorkflow(
  event: AnalyticsEvent,
): { event: AnalyticsEvent; page: PublicPage } | null {
  let workflow: "skill_publish" | "plugin_publish" | "authentication";
  if (event.name === "login") workflow = "authentication";
  else if (
    event.name === "form_start" ||
    event.name === "form_attempt" ||
    event.name === "form_validation_error"
  ) {
    if (event.params.form_id === "skill_report") return null;
    workflow = event.params.form_id;
  } else if (
    event.name === "resource_action" &&
    event.params.action === "publish" &&
    (event.params.content_type === "skill" || event.params.content_type === "plugin")
  ) {
    workflow = event.params.content_type === "skill" ? "skill_publish" : "plugin_publish";
    event = {
      name: "resource_action",
      params: {
        action: "publish",
        content_type: event.params.content_type,
        action_result: event.params.action_result,
      },
    };
  } else if (
    (event.name === "popup_view" || event.name === "popup_dismiss") &&
    event.params.ui_location === "publish" &&
    event.params.popup_id !== "promotion"
  ) {
    workflow = event.params.popup_id === "skill_published" ? "skill_publish" : "plugin_publish";
  } else return null;
  const titles = {
    skill_publish: "Skill publishing",
    plugin_publish: "Plugin publishing",
    authentication: "Authentication",
  };
  return {
    event,
    page: {
      page_location: `${PUBLIC_ORIGIN}/_analytics/workflows/${workflow.replace("_", "-")}`,
      page_title: `${titles[workflow]} workflow`,
      page_referrer: "",
      ui_location: workflow,
    },
  };
}

export function createGoogleAnalytics(
  nonce: string,
  browser: AnalyticsWindow = window,
  now: () => number = Date.now,
) {
  let initialized = false;
  let configured = false;
  let consentGeneration = 0;
  let contextGeneration = 0;
  let previousPath: string | null = null;
  let cachedNavigationCounted: boolean | undefined;
  let currentPage: PublicPage | null = null;
  let activeEpoch: string | null = null;
  const pending: Array<{
    event: AnalyticsEvent;
    page: PublicPage;
    capturedAt: number;
    epoch: string;
  }> = [];
  let errorCount = 0;
  let acceptsEvents = false;
  let consentGranted = false;
  const send = (event: AnalyticsEvent, deferred = false, context = currentPage) => {
    if (!currentPage || !context || browser["ga-disable-G-3SK7X2YLSJ"]) return false;
    if (event.name === "client_error" && errorCount++ >= 3) return false;
    const { content_id, content_type, ...pageContext } = context;
    browser.gtag?.("event", event.name, {
      ...pageContext,
      ...(deferred ? { event_deferred: 1 } : { content_id, content_type }),
      ...analyticsEventParameters(event),
      ...(deferred ? { ui_location: context.ui_location } : {}),
      send_to: GOOGLE_ANALYTICS_ID,
    });
    return true;
  };
  const disable = () => {
    browser["ga-disable-G-3SK7X2YLSJ"] = true;
  };
  const optOut = () => {
    consentGeneration++;
    disable();
    acceptsEvents = false;
    currentPage = null;
    pending.length = 0;
    activeEpoch = null;
    if (initialized && consentGranted)
      browser.gtag?.("consent", "update", { analytics_storage: "denied" });
    consentGranted = false;
  };
  const flush = () => {
    const time = now();
    for (const item of pending.splice(0)) {
      const age = time - item.capturedAt;
      if (acceptsEvents && item.epoch === activeEpoch && age >= 0 && age <= 30_000)
        send(item.event, true, item.page);
    }
  };
  const enqueue = (workflow: NonNullable<ReturnType<typeof deferredWorkflow>>) => {
    if (activeEpoch === null) return false;
    const time = now();
    for (let index = pending.length - 1; index >= 0; index--) {
      const age = time - pending[index].capturedAt;
      if (age < 0 || age > 30_000 || pending[index].epoch !== activeEpoch) pending.splice(index, 1);
    }
    if (pending.length === 8) pending.shift();
    pending.push({ ...workflow, capturedAt: time, epoch: activeEpoch });
    return true;
  };
  disable();
  return {
    pause: () => {
      contextGeneration++;
      disable();
    },
    captureOperation(workflow?: AnalyticsWorkflow) {
      if (!acceptsEvents || activeEpoch === null) return null;
      if (!workflow && (!currentPage || browser["ga-disable-G-3SK7X2YLSJ"])) return null;
      const epoch = activeEpoch;
      const consent = consentGeneration;
      const context = contextGeneration;
      const page = currentPage;
      const isValid = () =>
        acceptsEvents &&
        epoch === activeEpoch &&
        consent === consentGeneration &&
        (Boolean(workflow) ||
          (context === contextGeneration &&
            currentPage !== null &&
            !browser["ga-disable-G-3SK7X2YLSJ"]));
      return {
        isValid,
        send(event: AnalyticsEvent) {
          if (!isValid()) return false;
          if (!workflow) return send(event, false, page);
          const fixed = deferredWorkflow(event);
          if (!fixed || fixed.page.ui_location !== workflow) return false;
          // A workflow completion never inherits the unrelated page visible now.
          return send(fixed.event, true, fixed.page) || enqueue(fixed);
        },
      };
    },
    cacheNavigation(pathname: string) {
      contextGeneration++;
      cachedNavigationCounted = previousPath === pathname;
    },
    restoreNavigation() {
      // A resume-time consent grant may already have sent the first-ever view.
      // Only reset an identity that had actually been counted before caching.
      if (cachedNavigationCounted !== false) previousPath = null;
      cachedNavigationCounted = undefined;
    },
    isActive: () => Boolean(currentPage) && !browser["ga-disable-G-3SK7X2YLSJ"],
    trackDocumentVital(event: AnalyticsEvent, documentPage: PublicPage) {
      if (acceptsEvents && event.name === "web_vital") send(event, false, documentPage);
    },
    optOut,
    track(event: AnalyticsEvent) {
      if (!acceptsEvents) return;
      if (send(event)) return;
      const workflow = deferredWorkflow(event);
      if (workflow) enqueue(workflow);
    },
    update(
      page: PublicPage | null,
      pathname: string,
      {
        navigationPending = false,
        collectionAllowed = page ? true : acceptsEvents,
        consentEpoch = activeEpoch ?? "",
      }: { navigationPending?: boolean; collectionAllowed?: boolean; consentEpoch?: string } = {},
    ) {
      acceptsEvents = collectionAllowed;
      if (!collectionAllowed) {
        // Remember real departures while denied without recording those visits.
        // A consent toggle on the same document is not a new navigation.
        if (!navigationPending && previousPath !== pathname) previousPath = null;
        optOut();
        return;
      }
      if (consentEpoch !== activeEpoch) {
        consentGeneration++;
        pending.length = 0;
        activeEpoch = consentEpoch;
      }
      if (navigationPending) {
        contextGeneration++;
        disable();
        return;
      }
      // Temporary auth/loading ineligibility is not another navigation.
      if (previousPath !== pathname) previousPath = null;
      if (!page || !nonce) {
        contextGeneration++;
        disable();
        currentPage = null;
        return;
      }
      if (!initialized) {
        if (
          browser.gtag ||
          browser.document.querySelector('script[src*="googletagmanager.com/"]')
        ) {
          disable();
          return;
        }
        browser.dataLayer = browser.dataLayer || [];
        browser.gtag = function () {
          browser.dataLayer?.push(arguments);
        };
        browser.gtag("consent", "default", {
          analytics_storage: "denied",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        });
        browser.gtag("consent", "update", { analytics_storage: "granted" });
        consentGranted = true;
        browser.gtag("js", new Date());
        const script = browser.document.createElement("script");
        script.async = true;
        script.nonce = nonce;
        script.referrerPolicy = "no-referrer";
        script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`;
        browser.document.head.appendChild(script);
        initialized = true;
      }
      browser["ga-disable-G-3SK7X2YLSJ"] = false;
      if (!consentGranted) {
        browser.gtag?.("consent", "update", { analytics_storage: "granted" });
        consentGranted = true;
      }
      if (JSON.stringify(currentPage) !== JSON.stringify(page)) contextGeneration++;
      currentPage = page;
      // Native Enhanced Measurement reads persistent fields. Do not pin initial
      // page fields at config scope, where they would override later global sets.
      browser.gtag?.("set", {
        page_location: page.page_location,
        page_title: page.page_title,
        page_referrer: page.page_referrer,
      });
      if (!configured) {
        browser.gtag?.("config", GOOGLE_ANALYTICS_ID, {
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
        });
        configured = true;
      }
      if (previousPath === pathname) {
        flush();
        return;
      }
      previousPath = pathname;
      errorCount = 0;
      browser.gtag?.("event", "page_view", { ...page, send_to: GOOGLE_ANALYTICS_ID });
      flush();
    },
  };
}
