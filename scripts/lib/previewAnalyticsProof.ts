import { createHash } from "node:crypto";
import { chromium, type Route } from "@playwright/test";
import { ANALYTICS_POLICY_VERSION, GOOGLE_ANALYTICS_ENABLED } from "../../src/lib/analyticsConsent";
import { DEPLOYMENT_METADATA_PATH, parseDeploymentMetadata } from "./frontendBuildMetadata";

// A legacy record is seeded only by this proof; the application must ignore it.
const ANALYTICS_CHOICE_KEY = "clawhub.analytics.choice";

const FAILURE_CODES = [
  "PREVIEW_ORIGIN",
  "AUTHORIZED_ORIGIN",
  "POLICY_OBJECT",
  "POLICY_FIELDS",
  "POLICY_VERSION",
  "POLICY_GEOGRAPHY",
  "POLICY_CONTENT_TYPE",
  "POLICY_PRIVATE_NO_STORE",
  "POLICY_CDN_NO_STORE",
  "POLICY_VERCEL_CACHE",
  "POLICY_CACHED",
  "POLICY_CACHE_AGE",
  "POLICY_SPOOF_CHANGED",
  "POLICY_HTTP_STATUS",
  "PREVIEW_READ_FAILED",
  "FIXTURE_LOOKUP_FAILED",
  "FILE_HTTP_STATUS",
  "FILE_EMPTY",
  "HOME_INVALID",
  "CHECKOUT_SHA",
  "FIXTURE_SELECTOR",
  "READ_CREDENTIAL_REQUIRED",
  "BROWSER_HOME",
  "SEEDED_GRANT",
  "SDK_PRESENT",
  "GTAG_PRESENT",
  "UI_OVERRIDE",
  "ASSET_MISSING",
  "ASSET_HTTP_STATUS",
  "DEPLOYMENT_METADATA_HTTP",
  "DEPLOYMENT_METADATA_SCHEMA",
  "DEPLOYMENT_METADATA_CACHE",
  "DEPLOYMENT_METADATA_SHA",
  "DEPLOYMENT_METADATA_ASSET",
  "BROWSER_ROUTE_FAILED",
  "BROWSER_RUNTIME_FAILED",
  "BROWSER_PROBE_FAILED",
  "BROWSER_CLEANUP_FAILED",
  "GOOGLE_REQUEST",
  "GOOGLE_COOKIE",
  "ROUTE_CLEANUP_TIMEOUT",
  "UNEXPECTED_PROOF_FAILURE",
] as const;
type FailureCode = (typeof FAILURE_CODES)[number];
export class PreviewProofFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
    this.name = "PreviewProofFailure";
  }
}
export function safePreviewFailure(
  error: unknown,
  fallback: FailureCode = "UNEXPECTED_PROOF_FAILURE",
) {
  return new PreviewProofFailure(
    error instanceof PreviewProofFailure && FAILURE_CODES.includes(error.code)
      ? error.code
      : fallback,
  );
}

export function previewOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !/^clawhub-[a-z0-9-]+-openclaw-foundation\.vercel\.app$/.test(url.hostname)
  )
    throw new PreviewProofFailure("PREVIEW_ORIGIN");
  return url.origin;
}

export function authorizedPreviewRequest(
  origin: string,
  credential: string,
  path: string,
  country?: string,
) {
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new PreviewProofFailure("AUTHORIZED_ORIGIN");
  return {
    url: url.href,
    init: {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: {
        "x-vercel-protection-bypass": credential,
        ...(country ? { "x-vercel-ip-country": country } : {}),
      },
    } satisfies RequestInit,
  };
}

export function assertPreviewPolicy(body: unknown, headers: Headers) {
  if (headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw new PreviewProofFailure("POLICY_CONTENT_TYPE");
  assertFreshPreviewCache(headers);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new PreviewProofFailure("POLICY_OBJECT");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "policy_version,region_class,schema_version")
    throw new PreviewProofFailure("POLICY_FIELDS");
  if (value.schema_version !== 1 || value.policy_version !== ANALYTICS_POLICY_VERSION)
    throw new PreviewProofFailure("POLICY_VERSION");
  if (value.region_class !== "opt_in" && value.region_class !== "notice_opt_out")
    throw new PreviewProofFailure("POLICY_GEOGRAPHY");
  const tokens = (name: string) =>
    (headers.get(name) ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim());
  if (!tokens("cache-control").includes("private") || !tokens("cache-control").includes("no-store"))
    throw new PreviewProofFailure("POLICY_PRIVATE_NO_STORE");
  if (!tokens("cdn-cache-control").includes("no-store"))
    throw new PreviewProofFailure("POLICY_CDN_NO_STORE");
  if (
    headers.has("vercel-cdn-cache-control") &&
    !tokens("vercel-cdn-cache-control").includes("no-store")
  )
    throw new PreviewProofFailure("POLICY_VERCEL_CACHE");
  return {
    schema_version: 1,
    policy_version: ANALYTICS_POLICY_VERSION,
    region_class: value.region_class,
  };
}

export function assertSamePreviewPolicy(baseline: unknown, actual: unknown) {
  if (JSON.stringify(baseline) !== JSON.stringify(actual))
    throw new PreviewProofFailure("POLICY_SPOOF_CHANGED");
}

export function assertPreviewDeployment(
  value: unknown,
  headers: Headers,
  expectedSha: string,
  servedAsset: { path: string; sha256: string },
) {
  const metadata = parseDeploymentMetadata(value);
  if (!metadata) throw new PreviewProofFailure("DEPLOYMENT_METADATA_SCHEMA");
  if (metadata.git_commit_sha !== expectedSha)
    throw new PreviewProofFailure("DEPLOYMENT_METADATA_SHA");
  if (
    metadata.runtime_asset.path !== servedAsset.path ||
    metadata.runtime_asset.sha256 !== servedAsset.sha256
  )
    throw new PreviewProofFailure("DEPLOYMENT_METADATA_ASSET");
  const noStore = (name: string) =>
    (headers.get(name) ?? "")
      .toLowerCase()
      .split(",")
      .some((token) => token.trim() === "no-store");
  if (
    !noStore("cache-control") ||
    !noStore("cdn-cache-control") ||
    (headers.has("vercel-cdn-cache-control") && !noStore("vercel-cdn-cache-control"))
  )
    throw new PreviewProofFailure("DEPLOYMENT_METADATA_CACHE");
  try {
    // Vercel stores static files for the deployment lifetime, even when browser
    // caching is disabled. Exact commit and byte binding above prove provenance;
    // unlike the per-request region endpoint, a static HIT is not stale metadata.
    const cache = previewCacheEvidence(headers);
    if (cache.x_vercel_cache === "STALE")
      throw new PreviewProofFailure("DEPLOYMENT_METADATA_CACHE");
  } catch {
    throw new PreviewProofFailure("DEPLOYMENT_METADATA_CACHE");
  }
  return metadata;
}

export async function provePreviewAnalytics(
  origin: string,
  credential: string,
  expectedSha: string,
  evidence: Record<string, unknown> = {},
) {
  const cases: Array<{
    client_country: string;
    status: number;
    policy?: ReturnType<typeof assertPreviewPolicy>;
    age: number | null;
    x_vercel_cache: string | null;
    cache_control: string | null;
    cdn_cache_control: string | null;
    vercel_cdn_cache_control: string | null;
  }> = [];
  evidence.policy_cases = cases;
  for (const country of [undefined, "DE", "ZZ"]) {
    const request = authorizedPreviewRequest(origin, credential, "/api/analytics-consent", country);
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(20_000),
    });
    const observed = {
      client_country: country ?? "absent",
      status: response.status,
      ...previewCacheEvidence(response.headers),
      cache_control: response.headers.get("cache-control"),
      cdn_cache_control: response.headers.get("cdn-cache-control"),
      // Vercel may consume its own header. Report that separately, not as observed.
      vercel_cdn_cache_control: response.headers.get("vercel-cdn-cache-control"),
      policy: undefined as ReturnType<typeof assertPreviewPolicy> | undefined,
    };
    cases.push(observed);
    if (response.status !== 200) throw new PreviewProofFailure("POLICY_HTTP_STATUS");
    observed.policy = assertPreviewPolicy(await response.json(), response.headers);
    if (cases.length > 1) assertSamePreviewPolicy(cases[0].policy, observed.policy);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const google: Array<{ host: string; path: string }> = [];
  const errors: string[] = [];
  evidence.browser_error_codes = errors;
  evidence.google_attempts = google;
  const routeFailures: PreviewRouteFailure[] = [];
  evidence.browser_route_failures = routeFailures;
  let googleCookieNames: string[] = [];
  const pendingRoutes = new Set<Promise<void>>();
  let servedAsset: { path: string; sha256: string } | undefined;
  try {
    await context.addInitScript(
      ({ origin, key, version }) => {
        if (location.origin !== origin) return;
        const now = Date.now() - 1000;
        localStorage.setItem(
          key,
          JSON.stringify({
            schema_version: 1,
            policy_version: version,
            analytics: "granted",
            updated_at: new Date(now).toISOString(),
            expires_at: new Date(now + 180 * 86400000).toISOString(),
          }),
        );
      },
      { origin, key: ANALYTICS_CHOICE_KEY, version: ANALYTICS_POLICY_VERSION },
    );
    await context.route("**/*", (route) => {
      const work = routePreviewRequest(route, origin, credential, google, errors, routeFailures);
      pendingRoutes.add(work);
      return work.finally(() => pendingRoutes.delete(work));
    });
    const page = await context.newPage();
    page.on("pageerror", () => errors.push("BROWSER_RUNTIME_FAILED"));
    const response = await page.goto(origin, { waitUntil: "domcontentloaded" });
    if (response?.status() !== 200) throw new PreviewProofFailure("BROWSER_HOME");
    await page.waitForFunction(() => document.documentElement.dataset.clawhubHydrated === "true");
    const grant = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
      ANALYTICS_CHOICE_KEY,
    );
    if (grant?.analytics !== "granted" || grant.policy_version !== ANALYTICS_POLICY_VERSION)
      throw new PreviewProofFailure("SEEDED_GRANT");
    await page.waitForTimeout(2000);
    if (await page.locator('script[src*="googletagmanager.com"]').count())
      throw new PreviewProofFailure("SDK_PRESENT");
    if (
      await page.evaluate(() => typeof (window as Window & { gtag?: unknown }).gtag !== "undefined")
    )
      throw new PreviewProofFailure("GTAG_PRESENT");
    const choiceUi = await page
      .getByRole("button", { name: "Google Analytics choices", exact: true })
      .count();
    if (!GOOGLE_ANALYTICS_ENABLED && choiceUi) throw new PreviewProofFailure("UI_OVERRIDE");
    // A granted preference is distinct from collection eligibility: the tracker
    // independently excludes every preview origin, even when the source is on.
    evidence.browser_preference = await page.evaluate(
      () => document.documentElement.dataset.analyticsAllowed ?? null,
    );
    const asset = await page
      .locator('link[rel="modulepreload"]')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => (node as HTMLLinkElement).href)
          .find((href) => /\/runtimeEnv-[^/]+\.js$/.test(href)),
      );
    if (!asset) throw new PreviewProofFailure("ASSET_MISSING");
    const request = authorizedPreviewRequest(origin, credential, asset);
    const assetResponse = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(20_000),
    });
    if (!assetResponse.ok) throw new PreviewProofFailure("ASSET_HTTP_STATUS");
    const bytes = Buffer.from(await assetResponse.arrayBuffer());
    servedAsset = {
      path: new URL(asset).pathname,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const metadataRequest = authorizedPreviewRequest(origin, credential, DEPLOYMENT_METADATA_PATH);
    const metadataResponse = await fetch(metadataRequest.url, {
      ...metadataRequest.init,
      signal: AbortSignal.timeout(20_000),
    });
    if (!metadataResponse.ok) throw new PreviewProofFailure("DEPLOYMENT_METADATA_HTTP");
    evidence.deployment_metadata = assertPreviewDeployment(
      await metadataResponse.json(),
      metadataResponse.headers,
      expectedSha,
      servedAsset,
    );
    evidence.deployment_cache = previewCacheEvidence(metadataResponse.headers);
    await drainPreviewRoutes(pendingRoutes);
    await page.goto("about:blank");
    await drainPreviewRoutes(pendingRoutes);
    googleCookieNames = (await context.cookies(origin))
      .filter((cookie) => cookie.name === "_ga" || cookie.name === "_ga_3SK7X2YLSJ")
      .map((cookie) => cookie.name);
    evidence.google_cookie_names = googleCookieNames;
    if (googleCookieNames.length) throw new PreviewProofFailure("GOOGLE_COOKIE");
  } catch (error) {
    throw safePreviewFailure(error, "BROWSER_PROBE_FAILED");
  } finally {
    try {
      await context.close();
      await browser.close();
    } catch {
      throw new PreviewProofFailure("BROWSER_CLEANUP_FAILED");
    }
  }
  if (errors.length) throw new PreviewProofFailure("BROWSER_RUNTIME_FAILED");
  if (google.length) throw new PreviewProofFailure("GOOGLE_REQUEST");
  return {
    source_activation: GOOGLE_ANALYTICS_ENABLED,
    seeded_grant: true,
    google_requests: 0,
    google_cookie_names: googleCookieNames,
    observation_ms: 2000,
    policy_cases: cases,
    served_asset: servedAsset,
    deployment_metadata: evidence.deployment_metadata,
    deployment_cache: evidence.deployment_cache,
    browser_preference: evidence.browser_preference,
    browser_route_failures: routeFailures,
  };
}

export async function drainPreviewRoutes(pending: Set<Promise<void>>, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (Date.now() >= deadline) throw new PreviewProofFailure("ROUTE_CLEANUP_TIMEOUT");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([...pending]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new PreviewProofFailure("ROUTE_CLEANUP_TIMEOUT")),
            Math.max(1, deadline - Date.now()),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (pending.size);
}

function previewCacheEvidence(headers: Headers) {
  const rawAge = headers.get("age");
  const age = rawAge === null ? null : Number(rawAge);
  if (rawAge !== null && (!/^\d+$/.test(rawAge) || !Number.isSafeInteger(age)))
    throw new PreviewProofFailure("POLICY_CACHE_AGE");
  const state = headers.get("x-vercel-cache")?.trim().toUpperCase() ?? null;
  if (
    state !== null &&
    !["HIT", "STALE", "MISS", "BYPASS", "REVALIDATED", "PRERENDER"].includes(state)
  )
    throw new PreviewProofFailure("POLICY_VERCEL_CACHE");
  return { age, x_vercel_cache: state };
}

export function assertFreshPreviewCache(headers: Headers) {
  const evidence = previewCacheEvidence(headers);
  if (
    (evidence.age !== null && evidence.age > 0) ||
    evidence.x_vercel_cache === "HIT" ||
    evidence.x_vercel_cache === "STALE"
  )
    throw new PreviewProofFailure("POLICY_CACHED");
  return evidence;
}

type PreviewRouteFailure = {
  path_class: "unknown" | "home" | "asset" | "api" | "other" | "external" | "google";
  phase: "classify" | "fetch" | "redirect" | "read" | "fulfill" | "continue" | "abort";
  status: number | null;
  elapsed_ms: number;
};

export async function routePreviewRequest(
  route: Route,
  origin: string,
  credential: string,
  google: Array<{ host: string; path: string }>,
  errors: string[],
  failures: PreviewRouteFailure[] = [],
  fetchImpl: typeof fetch = fetch,
) {
  const started = Date.now();
  let recorded = false;
  const failure: PreviewRouteFailure = {
    path_class: "unknown",
    phase: "classify",
    status: null,
    elapsed_ms: 0,
  };
  const recordFailure = () => {
    if (recorded) return;
    recorded = true;
    errors.push("BROWSER_ROUTE_FAILED");
    // Fixed categories only. Never retain a URL, query, redirect location, header,
    // raw exception, or exception message, including in failed proof receipts.
    failure.elapsed_ms = Math.min(60_000, Math.max(0, Date.now() - started));
    if (failures.length < 32) failures.push(failure);
  };
  try {
    const url = new URL(route.request().url());
    if (
      /(^|\.)(google-analytics\.com|googletagmanager\.com|google\.com|doubleclick\.net|googlesyndication\.com)$/.test(
        url.hostname,
      )
    ) {
      failure.path_class = "google";
      failure.phase = "abort";
      google.push({ host: url.hostname, path: url.pathname });
      await route.abort();
    } else if (url.origin === origin) {
      failure.path_class =
        url.pathname === "/"
          ? "home"
          : url.pathname.startsWith("/assets/")
            ? "asset"
            : url.pathname.startsWith("/api/")
              ? "api"
              : "other";
      failure.phase = "fetch";
      // Existing job credential stays on this origin. Never follow an authenticated
      // redirect or pass it to a third-party browser request; do not record headers.
      const request = route.request();
      const postData = request.postDataBuffer();
      // Use the same native fetch transport as the successful protected HTTP
      // reads. Reject redirects: the credential must never follow one.
      const response = await fetchImpl(url.href, {
        method: request.method(),
        headers: { ...(await request.allHeaders()), "x-vercel-protection-bypass": credential },
        body: postData ? Uint8Array.from(postData).buffer : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      const status = response.status;
      failure.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
      if (status >= 300 && status < 400) {
        failure.phase = "redirect";
        recordFailure();
        await route.abort();
      } else {
        failure.phase = "read";
        const body = Buffer.from(await response.arrayBuffer());
        const headers = Object.fromEntries(response.headers);
        // Fetch decoded the payload; don't ask the browser to decode it again.
        delete headers["content-encoding"];
        delete headers["content-length"];
        delete headers["transfer-encoding"];
        const cookies = response.headers.getSetCookie();
        if (cookies.length) headers["set-cookie"] = cookies.join("\n");
        failure.phase = "fulfill";
        await route.fulfill({ status, headers, body });
      }
    } else {
      failure.path_class = "external";
      failure.phase = "continue";
      await route.continue();
    }
  } catch {
    // Playwright request errors include header call logs. Discard the entire raw
    // error before it reaches a callback, log, receipt, or uploaded artifact.
    recordFailure();
    await route.abort().catch(() => undefined);
  }
}
