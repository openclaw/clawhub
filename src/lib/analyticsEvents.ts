type AnalyticsContentType =
  | "skill"
  | "plugin"
  | "catalog_skill"
  | "navigation"
  | "install"
  | "search"
  | "form";
type AnalyticsLocation =
  | "header"
  | "footer"
  | "catalog"
  | "search_results"
  | "detail"
  | "install"
  | "publish"
  | "promotion";
type Result = "success" | "error" | "attempt" | "accepted";

type AnalyticsEvents = {
  select_content: {
    content_type: AnalyticsContentType;
    content_id?: string;
    ui_location: AnalyticsLocation;
    method?: string;
    artifact_version?: string;
  };
  copy_action: {
    content_type: AnalyticsContentType;
    action_result: "success" | "error";
    ui_location: AnalyticsLocation;
    method?: string;
  };
  resource_action: {
    action: "star" | "unstar" | "publish" | "report" | "search_results" | "read";
    content_type: AnalyticsContentType;
    action_result: Result;
    content_id?: string;
    ui_location?: AnalyticsLocation;
    result_count?: number;
    search_context?: "skills" | "plugins" | "all";
    search_status?: "complete" | "partial" | "error";
    search_filter?: "none" | "category" | "topic" | "sort" | "featured" | "multiple";
    engagement_seconds?: 30 | 60;
  };
  popup_view: {
    popup_id: "skill_published" | "plugin_submitted" | "promotion";
    ui_location: AnalyticsLocation;
  };
  popup_dismiss: {
    popup_id: "skill_published" | "plugin_submitted" | "promotion";
    ui_location: AnalyticsLocation;
    dismiss_method: "button" | "escape" | "outside" | "programmatic";
  };
  form_validation_error: {
    form_id: "skill_publish" | "plugin_publish" | "skill_report";
    field_name: "form" | "publisher" | "license" | "files";
    error_code: "invalid" | "required" | "size_limit" | "conflict";
  };
  login: { method: "github" };
  search: {
    search_term: string;
    search_context: "all" | "skills" | "plugins";
    ui_location: AnalyticsLocation;
  };
  content_engagement: { engagement_seconds: 30 | 60 };
  form_attempt: {
    form_id: "skill_publish" | "plugin_publish" | "skill_report";
    ui_location: AnalyticsLocation;
  };
  form_start: {
    form_id: "skill_publish" | "plugin_publish" | "skill_report";
    ui_location: AnalyticsLocation;
  };
  scroll_depth: { percent_scrolled: 25 | 50 | 75 };
  section_view: { section_id: "catalog" | "install" | "readme" | "security" | "footer" };
  web_vital: {
    metric_name: "LCP" | "INP" | "CLS";
    lcp_ms?: number;
    inp_ms?: number;
    cls_score?: number;
    metric_rating: "good" | "needs-improvement" | "poor";
    navigation_type: string;
    release: string;
  };
  client_error: {
    error_type: "render" | "runtime" | "promise";
    error_code: "render_failed" | "uncaught" | "unhandled_rejection";
    release?: string;
  };
};

export type AnalyticsEvent = {
  [Name in keyof AnalyticsEvents]: { name: Name; params: AnalyticsEvents[Name] };
}[keyof AnalyticsEvents];
export const ANALYTICS_EVENT = "clawhub:analytics";
export type AnalyticsWorkflow = "skill_publish" | "plugin_publish" | "authentication";
type OperationSink = {
  isValid(): boolean;
  send(event: AnalyticsEvent): boolean;
};
export type AnalyticsOperation = {
  isValid(): boolean;
  emit<Name extends keyof AnalyticsEvents>(name: Name, params: AnalyticsEvents[Name]): boolean;
};
let operationFactory: ((workflow?: AnalyticsWorkflow) => OperationSink | null) | undefined;

export function registerAnalyticsOperations(factory: NonNullable<typeof operationFactory>) {
  operationFactory = factory;
  return () => {
    if (operationFactory === factory) operationFactory = undefined;
  };
}

// Capture permission and the owner's safe context before starting asynchronous work.
// A later grant must never turn a denied or superseded operation into telemetry.
export function captureAnalyticsOperation(workflow?: AnalyticsWorkflow): AnalyticsOperation | null {
  if (typeof window === "undefined" || !analyticsPreferenceAllowsCollection()) return null;
  const sink = operationFactory?.(workflow);
  if (!sink) return null;
  const epoch = document.documentElement.dataset.analyticsConsentEpoch;
  const isValid = () =>
    analyticsPreferenceAllowsCollection() &&
    epoch === document.documentElement.dataset.analyticsConsentEpoch &&
    sink.isValid();
  return {
    isValid,
    emit: (name, params) => {
      if (!isValid()) return false;
      try {
        return sink.send({ name, params } as AnalyticsEvent);
      } catch {
        // Measurement must never change the success/failure of the user's action.
        return false;
      }
    },
  };
}
const NATIVE_SEARCH_KEYS = new Set(["q", "s", "search", "query", "keyword"]);
const FUNCTIONAL_SEARCH_PATHS = new Set([
  "/search",
  "/skills",
  "/plugins",
  "/publishers",
  "/official",
  "/users",
  "/dashboard",
]);

export function normalizeNonfunctionalSearchKeys(href: string) {
  const url = new URL(href);
  const functionalQ = FUNCTIONAL_SEARCH_PATHS.has(url.pathname.replace(/\/$/, ""));
  const kept = url.search
    .slice(1)
    .split("&")
    .filter((part) => {
      let key: string;
      try {
        key = decodeURIComponent(part.split("=", 1)[0].replace(/\+/g, " ")).toLowerCase();
      } catch {
        return true;
      }
      return !NATIVE_SEARCH_KEYS.has(key) || (key === "q" && functionalQ);
    });
  // Keep the exact bytes/order of functional parameters, UTMs, linker, and hash.
  const withoutHash = href.split("#", 1)[0];
  const base = withoutHash.split("?", 1)[0];
  return `${base}${kept.some(Boolean) ? `?${kept.join("&")}` : ""}${url.hash}`;
}

export function isSafeNativeSearchContext(url: URL) {
  const entries = [...url.searchParams].filter(([key]) =>
    NATIVE_SEARCH_KEYS.has(key.toLowerCase()),
  );
  if (!entries.length) return true;
  // Unsupported aliases, duplicate parameters, and account searches never reach GA.
  return (
    entries.length === 1 &&
    entries[0][0] === "q" &&
    ["/search", "/skills", "/plugins"].includes(url.pathname.replace(/\/$/, "")) &&
    (!entries[0][1] || Boolean(safePublicSearchTerm(entries[0][1]))) &&
    url.searchParams.get("type") !== "creators"
  );
}

const EVENT_FIELDS: Record<AnalyticsEvent["name"], readonly string[]> = {
  select_content: ["content_type", "content_id", "ui_location", "method", "artifact_version"],
  copy_action: ["content_type", "action_result", "ui_location", "method"],
  resource_action: [
    "action",
    "content_type",
    "action_result",
    "content_id",
    "ui_location",
    "result_count",
    "search_context",
    "search_status",
    "search_filter",
  ],
  popup_view: ["popup_id", "ui_location"],
  popup_dismiss: ["popup_id", "ui_location", "dismiss_method"],
  form_validation_error: ["form_id", "field_name", "error_code"],
  form_attempt: ["form_id", "ui_location"],
  form_start: ["form_id", "ui_location"],
  login: ["method"],
  search: ["search_term", "search_context", "ui_location"],
  content_engagement: ["engagement_seconds"],
  scroll_depth: ["percent_scrolled"],
  section_view: ["section_id"],
  web_vital: [
    "metric_name",
    "metric_rating",
    "navigation_type",
    "release",
    "lcp_ms",
    "inp_ms",
    "cls_score",
  ],
  client_error: ["error_type", "error_code", "release"],
};

export function analyticsEventParameters(event: AnalyticsEvent) {
  const fields = EVENT_FIELDS[event.name];
  if (!fields) return {};
  const params: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(event.params)) {
    if (!fields.includes(key)) continue;
    if (typeof value === "string" && value.length <= 100 && !/[\r\n]/.test(value))
      params[key] = value;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) params[key] = value;
    if (typeof value === "boolean") params[key] = value;
  }
  // An accidental extra field can never turn an application event into identity,
  // page-location, user-provided-data, or raw error transport.
  return params;
}

export function isSensitiveAnalyticsDestination(href: string, origin: string) {
  try {
    const url = new URL(href, origin);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return true;
    if (/\/(?:auth|oauth|account|settings|private)(?:\/|$)/i.test(url.pathname)) return true;
    for (const [key, value] of url.searchParams) {
      if (
        /token|secret|password|auth|signature|^sig$|^code$|^key$|api.?key|^x-amz-/i.test(key) ||
        /@|\b\d{7,}\b|[a-f0-9]{32,}/i.test(value)
      )
        return true;
    }
    return /token|secret|password|auth|=|@/i.test(url.hash);
  } catch {
    return true;
  }
}

// Values come from typed application outcomes, never DOM text or entered form values.
export function emitAnalytics<Name extends keyof AnalyticsEvents>(
  name: Name,
  params: AnalyticsEvents[Name],
) {
  if (typeof window === "undefined" || !analyticsPreferenceAllowsCollection()) return false;
  window.dispatchEvent(
    new CustomEvent(ANALYTICS_EVENT, {
      detail: { name, params, pathname: window.location.pathname },
    }),
  );
  return true;
}

export function analyticsPreferenceAllowsCollection(browser: Window = window) {
  return (
    !hasAnalyticsPrivacySignal(browser) &&
    browser.document.documentElement.dataset.analyticsAllowed === "true" &&
    /^automatic-public:\d+$/.test(
      browser.document.documentElement.dataset.analyticsConsentEpoch ?? "",
    )
  );
}

export function safePublicSearchTerm(value: string | null | undefined) {
  const term = value?.trim().replace(/\s+/g, " ");
  if (!term || term.length > 80 || !/^[\p{L}\p{N} _.-]+$/u.test(term)) return null;
  if (
    /\d{5}|[a-f0-9]{24}|(?:password|passwd|secret|token|authorization|api.?key|bearer|private.?key|ssn)\b/i.test(
      term,
    )
  )
    return null;
  return term;
}

export function emitPublicSearchSubmission(
  value: string,
  context: "all" | "skills" | "plugins",
  location: AnalyticsLocation,
) {
  const term = safePublicSearchTerm(value);
  if (term)
    emitAnalytics("search", { search_term: term, search_context: context, ui_location: location });
}

export function analyticsSearchFilter(search: {
  category?: unknown;
  topic?: unknown;
  sort?: unknown;
  featured?: unknown;
}): "none" | "category" | "topic" | "sort" | "featured" | "multiple" {
  const active: Array<"category" | "topic" | "sort" | "featured"> = [];
  if (search.category) active.push("category");
  if (search.topic) active.push("topic");
  if (
    typeof search.sort === "string" &&
    !["recommended", "relevance", "default"].includes(search.sort)
  )
    active.push("sort");
  if (search.featured) active.push("featured");
  return active.length > 1 ? "multiple" : (active[0] ?? "none");
}

export function safeReferralOrigin(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      /^[\d.]+$/.test(url.hostname)
    )
      return "";
    return `${url.origin}/`;
  } catch {
    return "";
  }
}

// Only authoritative public RESOURCE identities belong here, never visitor/account IDs.
export function publicAnalyticsContentId(
  kind: "skill" | "plugin" | "catalog_skill",
  identity: string,
) {
  return `${kind}:${identity}`.slice(0, 100);
}
import { hasAnalyticsPrivacySignal } from "./analyticsConsent";
