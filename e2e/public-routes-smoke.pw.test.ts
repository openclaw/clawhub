import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { stubExternalMediaInVitePreview } from "./helpers/externalMedia";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "./helpers/runtimeErrors";

type SeedFixtures = {
  skill: {
    displayName: string;
    ownerHandle: string;
    slug: string;
  };
  plugin: {
    displayName: string;
    name: string;
  };
};

type PublicRouteCase = {
  label: string;
  path: (fixtures: SeedFixtures) => string;
  assert: (page: Page, fixtures: SeedFixtures) => Promise<void>;
};

function pluginDetailPath(name: string) {
  const scopedMatch = /^@([^/]+)\/([^/]+)$/.exec(name.trim());
  if (scopedMatch) {
    return `/plugins/@${encodeURIComponent(scopedMatch[1]!)}/${encodeURIComponent(scopedMatch[2]!)}`;
  }
  return `/plugins/${encodeURIComponent(name.trim())}`;
}

function seedApiUrl(path: string) {
  const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL?.trim();
  return convexSiteUrl ? new URL(path, convexSiteUrl).toString() : path;
}

async function getSeedFixture(request: APIRequestContext, path: string) {
  let lastResponse: Awaited<ReturnType<APIRequestContext["get"]>> | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lastResponse = await request.get(seedApiUrl(path));
    if (lastResponse.ok()) return lastResponse;
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  return lastResponse!;
}

async function expectHomeHeroBackgroundCentered(page: Page) {
  const metrics = await page.locator(".home-v2-hero-bg").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      backgroundCenter: rect.left + rect.width / 2,
      backgroundWidth: rect.width,
      viewportCenter: window.innerWidth / 2,
      viewportWidth: window.innerWidth,
    };
  });

  expect(metrics.backgroundWidth).toBeGreaterThanOrEqual(metrics.viewportWidth - 20);
  expect(Math.abs(metrics.backgroundCenter - metrics.viewportCenter)).toBeLessThanOrEqual(10);
}

async function fetchSeedFixtures(request: APIRequestContext): Promise<SeedFixtures> {
  const skillPath = "/api/v1/skills/gifgrep";
  const skillResponse = await getSeedFixture(request, skillPath);
  expect(
    skillResponse.ok(),
    `seed skill fixture ${skillPath} returned ${skillResponse.status()}`,
  ).toBe(true);
  const skillPayload = (await skillResponse.json()) as {
    owner?: { handle?: string | null };
    skill?: { displayName?: string | null; slug?: string | null };
  };
  const ownerHandle = skillPayload.owner?.handle?.trim();
  const skillSlug = skillPayload.skill?.slug?.trim();
  const skillDisplayName = skillPayload.skill?.displayName?.trim();
  expect(ownerHandle, "gifgrep seed fixture needs an owner handle").toBeTruthy();
  expect(skillSlug, "gifgrep seed fixture needs a slug").toBeTruthy();
  expect(skillDisplayName, "gifgrep seed fixture needs a display name").toBeTruthy();

  const pluginPath = "/api/v1/plugins?limit=1";
  const pluginResponse = await getSeedFixture(request, pluginPath);
  expect(
    pluginResponse.ok(),
    `seed plugin catalog ${pluginPath} returned ${pluginResponse.status()}`,
  ).toBe(true);
  const pluginPayload = (await pluginResponse.json()) as {
    items?: Array<{ displayName?: string | null; name?: string | null }>;
  };
  const plugin = pluginPayload.items?.find((item) => item.name?.trim() && item.displayName?.trim());
  expect(plugin, "seed plugin catalog needs at least one public plugin").toBeTruthy();

  return {
    skill: {
      displayName: skillDisplayName!,
      ownerHandle: ownerHandle!,
      slug: skillSlug!,
    },
    plugin: {
      displayName: plugin!.displayName!.trim(),
      name: plugin!.name!.trim(),
    },
  };
}

function publicRouteCases(): PublicRouteCase[] {
  return [
    {
      label: "home",
      path: () => "/",
      assert: async (page) => {
        await expect(page.locator("body")).toContainText("ClawHub");
        await expectHomeHeroBackgroundCentered(page);
      },
    },
    {
      label: "skills browse",
      path: () => "/skills",
      assert: async (page) => {
        await expect(page.getByRole("heading", { name: /^Skills/ })).toBeVisible();
      },
    },
    {
      label: "plugins browse",
      path: () => "/plugins",
      assert: async (page) => {
        await expect(page.getByRole("heading", { name: /^Plugins/ })).toBeVisible();
      },
    },
    {
      label: "creators browse",
      path: () => "/creators",
      assert: async (page) => {
        await expect(page.getByRole("heading", { name: /^Creators/ })).toBeVisible();
      },
    },
    {
      label: "publishers browse redirect",
      path: () => "/publishers",
      assert: async (page) => {
        await expect(page).toHaveURL(/\/creators/);
        await expect(page.getByRole("heading", { name: /^Creators/ })).toBeVisible();
      },
    },
    {
      label: "search results",
      path: () => "/search?q=gifgrep",
      assert: async (page) => {
        await expect(
          page.getByRole("heading", { name: /Search results for "gifgrep"/ }),
        ).toBeVisible();
      },
    },
    {
      label: "skill detail",
      path: (fixtures) =>
        `/${encodeURIComponent(fixtures.skill.ownerHandle)}/${encodeURIComponent(fixtures.skill.slug)}`,
      assert: async (page, fixtures) => {
        await expect(
          page.getByRole("heading", { name: fixtures.skill.displayName }).first(),
        ).toBeVisible();
      },
    },
    {
      label: "skill security audit",
      path: (fixtures) =>
        `/${encodeURIComponent(fixtures.skill.ownerHandle)}/${encodeURIComponent(
          fixtures.skill.slug,
        )}/security-audit`,
      assert: async (page) => {
        await expect(page.getByText("Security Audit").first()).toBeVisible();
      },
    },
    {
      label: "publisher profile",
      path: (fixtures) => `/user/${encodeURIComponent(fixtures.skill.ownerHandle)}`,
      assert: async (page) => {
        await expect(page.getByRole("region", { name: "Publisher catalog" })).toBeVisible();
      },
    },
    {
      label: "plugin detail",
      path: (fixtures) => pluginDetailPath(fixtures.plugin.name),
      assert: async (page, fixtures) => {
        await expect(
          page.getByRole("heading", { name: fixtures.plugin.displayName }).first(),
        ).toBeVisible();
      },
    },
    {
      label: "plugin security audit",
      path: (fixtures) => `${pluginDetailPath(fixtures.plugin.name)}/security-audit`,
      assert: async (page) => {
        await expect(
          page.getByText(/Security Audit|Security audit is unavailable/i).first(),
        ).toBeVisible();
      },
    },
    {
      label: "signed-out skill publish",
      path: () => "/skills/publish",
      assert: async (page) => {
        await expect(page.getByText("Sign in to publish a skill")).toBeVisible();
      },
    },
    {
      label: "signed-out plugin publish",
      path: () => "/plugins/publish",
      assert: async (page) => {
        await expect(page.getByText("Sign in to publish a plugin")).toBeVisible();
      },
    },
    {
      label: "signed-out import",
      path: () => "/import",
      assert: async (page) => {
        await expect(page.getByText("Sign in to import and publish skills")).toBeVisible();
      },
    },
  ];
}

async function expectPublicRouteHealthy(
  page: Page,
  route: PublicRouteCase,
  fixtures: SeedFixtures,
) {
  await stubExternalMediaInVitePreview(page);
  const errors = trackRuntimeErrors(page);
  const path = route.path(fixtures);
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${route.label} should return a response`).not.toBeNull();
  expect(response!.status(), `${route.label} should not return a 5xx response`).toBeLessThan(500);
  await expect(page.locator("body")).not.toContainText(/\bServer Error\b/i);
  await waitForHydration(page);
  await route.assert(page, fixtures);
  await expectHealthyPage(page, errors);
}

for (const route of publicRouteCases()) {
  test(`public route renders: ${route.label}`, async ({ page, request }) => {
    const fixtures = await fetchSeedFixtures(request);
    await expectPublicRouteHealthy(page, route, fixtures);
  });
}
