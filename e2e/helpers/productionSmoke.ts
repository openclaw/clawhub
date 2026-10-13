import { expect, test as base, type BrowserContext } from "@playwright/test";

const PRODUCTION_ORIGIN = "https://clawhub.ai";

export async function protectProductionSmokeContext(
  context: BrowserContext,
  baseURL: string | undefined,
) {
  if (!baseURL || new URL(baseURL).origin !== PRODUCTION_ORIGIN) return () => {};

  // This is an automated smoke visitor, not an analytics acceptance session.
  // Leave all supplied authentication cookies and local storage untouched.
  await context.addInitScript((origin) => {
    if (location.origin === origin)
      Object.defineProperty(navigator, "globalPrivacyControl", { value: true });
  }, PRODUCTION_ORIGIN);

  const attempts: string[] = [];
  await context.route(
    /^https?:\/\/([^/]+\.)?(google-analytics\.com|googletagmanager\.com|google\.com|doubleclick\.net|googlesyndication\.com)(?:\/|$)/,
    async (route) => {
      // A regression must fail the smoke test without forwarding measurement.
      // Never retain query strings, headers, or existing authentication state.
      const url = new URL(route.request().url());
      attempts.push(url.hostname === "www.googletagmanager.com" ? "sdk" : "google-request");
      await route.abort();
    },
  );
  return () => expect(attempts, "Production smoke must not request Google analytics").toEqual([]);
}

type SmokeFixtures = {
  prepareSmokeContext: (context: BrowserContext) => Promise<void>;
  _productionSmokePrivacy: void;
};

export const test = base.extend<SmokeFixtures>({
  prepareSmokeContext: async ({ baseURL }, use) => {
    const guards: Array<() => void> = [];
    await use(async (context) => {
      guards.push(await protectProductionSmokeContext(context, baseURL));
    });
    for (const assertNoGoogleRequests of guards) assertNoGoogleRequests();
  },
  _productionSmokePrivacy: [
    async ({ context, prepareSmokeContext }, use) => {
      await prepareSmokeContext(context);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
