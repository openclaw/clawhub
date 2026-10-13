import type { BrowserContext } from "@playwright/test";
import { test, expect, protectProductionSmokeContext } from "./helpers/productionSmoke";

const origin = "https://clawhub.ai";
const storageState = {
  cookies: [
    {
      name: "fixture_auth",
      value: "preserved",
      domain: "clawhub.ai",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
  ],
  origins: [
    {
      origin,
      localStorage: [
        { name: "fixture_auth_state", value: "preserved" },
        { name: "clawhub.analytics.choice", value: "existing-choice-untouched" },
      ],
    },
  ],
};
const document =
  '<!doctype html><script>window.initialGpc=navigator.globalPrivacyControl;window.initialAuth=localStorage.getItem("fixture_auth_state")</script>';

function sortedState(state: Awaited<ReturnType<BrowserContext["storageState"]>>) {
  return {
    ...state,
    cookies: [...state.cookies].sort((a, b) => a.name.localeCompare(b.name)),
    origins: state.origins
      .map((entry) => ({
        ...entry,
        localStorage: [...entry.localStorage].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.origin.localeCompare(b.origin)),
  };
}

test.use({ baseURL: origin, storageState });

// These are isolated fixture-contract checks, not simulated product UI proof.
// The unchanged menu smoke tests separately exercise the real hosted application.
test("default smoke context applies GPC before scripts and preserves storage", async ({
  context,
  page,
}) => {
  await context.route(`${origin}/**`, (route) =>
    route.fulfill({ contentType: "text/html", body: document }),
  );
  await page.goto("/");
  expect(await page.evaluate(() => (window as Window & { initialGpc?: boolean }).initialGpc)).toBe(
    true,
  );
  expect(sortedState(await context.storageState())).toEqual(sortedState(storageState));
});

test("explicit authenticated context preserves all supplied auth state", async ({
  browser,
  prepareSmokeContext,
}) => {
  const context = await browser.newContext({ storageState });
  try {
    await prepareSmokeContext(context);
    await context.route(`${origin}/**`, (route) =>
      route.fulfill({ contentType: "text/html", body: document }),
    );
    const page = await context.newPage();
    await page.goto(origin);
    expect(
      await page.evaluate(() => (window as Window & { initialGpc?: boolean }).initialGpc),
    ).toBe(true);
    expect(
      await page.evaluate(() => (window as Window & { initialAuth?: string }).initialAuth),
    ).toBe("preserved");
    expect(sortedState(await context.storageState())).toEqual(sortedState(storageState));
  } finally {
    await context.close();
  }
});

test("non-production contexts keep their own privacy behavior", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const assertNoRequests = await protectProductionSmokeContext(context, "http://127.0.0.1:4173");
    await context.route("http://127.0.0.1:4173/**", (route) =>
      route.fulfill({ contentType: "text/html", body: document }),
    );
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4173");
    expect(
      await page.evaluate(() => (window as Window & { initialGpc?: boolean }).initialGpc),
    ).not.toBe(true);
    assertNoRequests();
  } finally {
    await context.close();
  }
});

test("unexpected Google requests abort and fail the guard without reaching the network", async ({
  browser,
}) => {
  const context = await browser.newContext();
  let fallbackGoogleRequests = 0;
  try {
    // This lower-priority local fence prevents network even if the guard regresses.
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).hostname === "www.google-analytics.com") {
        fallbackGoogleRequests++;
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fulfill({ contentType: "text/html", body: document });
    });
    const assertNoRequests = await protectProductionSmokeContext(context, origin);
    const page = await context.newPage();
    await page.goto(origin);
    const outcome = await page.evaluate(() =>
      fetch("https://www.google-analytics.com/g/collect?fixture=dummy", { mode: "no-cors" })
        .then(() => "completed")
        .catch(() => "aborted"),
    );
    expect(outcome).toBe("aborted");
    expect(fallbackGoogleRequests).toBe(0);
    expect(assertNoRequests).toThrow("Production smoke must not request Google analytics");
  } finally {
    await context.close();
  }
});
