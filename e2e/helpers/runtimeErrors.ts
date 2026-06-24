import { expect, type ConsoleMessage, type Page } from "@playwright/test";
import { isKnownOpenClawMediaUrl } from "./externalMedia";

const EXTERNAL_RESOURCE_DNS_ERROR = "Failed to load resource: net::ERR_NAME_NOT_RESOLVED";

function isIgnoredExternalResourceDnsError(message: ConsoleMessage) {
  if (message.text() !== EXTERNAL_RESOURCE_DNS_ERROR) return false;
  return isKnownOpenClawMediaUrl(message.location().url);
}

export function trackRuntimeErrors(page: Page) {
  const errors: string[] = [];

  page.on("pageerror", (error) => {
    errors.push(`pageerror:${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isIgnoredExternalResourceDnsError(message)) return;
    errors.push(`console:${message.text()}`);
  });

  return errors;
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
