import { expect, type Page } from "@playwright/test";

export function trackRuntimeErrors(page: Page) {
  const errors: string[] = [];

  page.on("pageerror", (error) => {
    errors.push(`pageerror:${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
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
