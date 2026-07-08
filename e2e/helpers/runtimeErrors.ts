import { expect, type ConsoleMessage, type Page } from "@playwright/test";
import { isKnownOpenClawMediaUrl } from "./externalMedia";

const EXTERNAL_RESOURCE_DNS_ERROR = "Failed to load resource: net::ERR_NAME_NOT_RESOLVED";
const TRANSIENT_CHROMIUM_RESOURCE_ERRORS = new Set([
  "Failed to load resource: net::ERR_NETWORK_CHANGED",
]);

function isIgnoredExternalResourceDnsError(message: ConsoleMessage) {
  if (message.text() !== EXTERNAL_RESOURCE_DNS_ERROR) return false;
  return isKnownOpenClawMediaUrl(message.location().url);
}

function isIgnoredTransientResourceError(message: ConsoleMessage) {
  return TRANSIENT_CHROMIUM_RESOURCE_ERRORS.has(message.text());
}

export function trackRuntimeErrors(page: Page) {
  const errors: string[] = [];

  page.on("pageerror", (error) => {
    errors.push(`pageerror:${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isIgnoredExternalResourceDnsError(message)) return;
    if (isIgnoredTransientResourceError(message)) return;
    errors.push(`console:${message.text()}`);
  });

  return errors;
}

// React production builds report recoverable hydration mismatches as #418 page errors.
// Keep the filter opt-in so tests still fail on unexpected hydration regressions by default.
export function withoutRecoverableReactHydrationErrors(errors: string[]) {
  return errors.filter((error) => !error.includes("pageerror:Minified React error #418"));
}

export async function expectNoRuntimeErrors(page: Page, errors: string[]) {
  await expect
    .poll(() => errors, {
      message: `Unexpected runtime errors on ${page.url() || "unknown page"}`,
      timeout: 1000,
    })
    .toEqual([]);
}

export async function expectNoFatalErrorUi(page: Page) {
  await expect(page.locator("text=Something went wrong!")).toHaveCount(0);
  await expect(page.locator("text=Hide Error")).toHaveCount(0);
}

export async function expectHealthyPage(page: Page, errors: string[]) {
  await expectNoFatalErrorUi(page);
  await expectNoRuntimeErrors(page, errors);
}

export async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.clawhubHydrated === "true",
    undefined,
    { timeout: 15_000 },
  );
}
