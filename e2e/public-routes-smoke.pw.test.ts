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
      label: "official browse",
      path: () => "/official",
      assert: async (page) => {
        await expect(page.getByRole("heading", { name: /^Official/ })).toBeVisible();
      },
    },
    {
      label: "publishers browse redirect",
      path: () => "/publishers",
      assert: async (page) => {
        await expect(page).toHaveURL(/\/official/);
        await expect(page.getByRole("heading", { name: /^Official/ })).toBeVisible();
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

test("skill hero metadata keeps semantic wrap groups on mobile", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  await page.route("**/_vercel/image?**", (route) => route.fulfill({ status: 204 }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/skills-sh/skills-101/superpowers/ai-video-generation", {
    waitUntil: "domcontentloaded",
  });
  await waitForHydration(page);

  const taxonomy = page.getByLabel("Skill metadata");
  const source = taxonomy.locator(".skill-hero-taxonomy-prefix");
  const categories = taxonomy.locator(".skill-category-meta-link");
  const category = categories.first();
  const topics = taxonomy.locator(".skill-hero-topic");
  const creatorName = page.locator(".skill-hero-creator .user-name");
  const creatorHandle = page.locator(".skill-hero-creator .user-handle");

  await expect(taxonomy).toBeVisible();
  await expect(source).toContainText("Synced from skills.sh");
  await expect(category).toBeVisible();
  await expect(topics.first()).toBeVisible();
  await expect(creatorName).toBeVisible();
  await expect(creatorHandle).toBeVisible();

  const taxonomyWeights = await taxonomy
    .locator(".skills-sh-sync-source-label, .skill-category-meta-link, .skill-hero-topic")
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fontWeight));
  expect(new Set(taxonomyWeights)).toEqual(new Set(["400"]));
  await expect(creatorHandle).toHaveCSS("font-weight", "400");
  await expect(creatorName).not.toHaveCSS("font-weight", "400");
  const creatorTypeSizes = await Promise.all(
    [creatorName, creatorHandle].map(async (locator) =>
      Number.parseFloat(await locator.evaluate((element) => getComputedStyle(element).fontSize)),
    ),
  );
  expect(creatorTypeSizes[1]).toBeLessThan(creatorTypeSizes[0]!);
  await expect(creatorHandle).toHaveCSS("font-size", "12px");
  const creatorColors = await creatorHandle.evaluate((handleElement) => {
    const nameElement = handleElement.closest(".skill-hero-creator")?.querySelector(".user-name");
    if (!nameElement) throw new Error("Creator display name is missing");
    const secondaryProbe = document.createElement("span");
    secondaryProbe.style.color = "var(--ink-soft)";
    document.body.append(secondaryProbe);
    const colors = {
      handle: getComputedStyle(handleElement).color,
      name: getComputedStyle(nameElement).color,
      secondary: getComputedStyle(secondaryProbe).color,
    };
    secondaryProbe.remove();
    return colors;
  });
  expect(creatorColors.handle).toBe(creatorColors.secondary);
  expect(creatorColors.handle).not.toBe(creatorColors.name);
  await expect(taxonomy.locator(".skill-hero-taxonomy-separator").first()).not.toHaveCSS(
    "display",
    "none",
  );

  await page.setViewportSize({ width: 600, height: 900 });
  await expect(topics.first()).toHaveCSS("display", "inline-flex");
  const fittingGroupTops = await Promise.all(
    [source, category, topics.first()].map(async (locator) => (await locator.boundingBox())?.y),
  );
  expect(fittingGroupTops.every((top) => top !== undefined)).toBe(true);
  expect(
    Math.max(...(fittingGroupTops as number[])) - Math.min(...(fittingGroupTops as number[])),
  ).toBeLessThanOrEqual(1);

  const mobileSeparatorStyles = await taxonomy
    .locator(".skill-category-meta-link, .skill-hero-topic")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element, "::before");
        return {
          backgroundColor: style.backgroundColor,
          content: style.content,
          height: style.height,
          width: style.width,
        };
      }),
    );
  expect(mobileSeparatorStyles.length).toBeGreaterThanOrEqual(2);
  expect(
    mobileSeparatorStyles.every(
      (style) =>
        style.content !== "none" &&
        style.content !== "normal" &&
        style.width === "1px" &&
        style.height === "14px" &&
        style.backgroundColor !== "rgba(0, 0, 0, 0)",
    ),
  ).toBe(true);

  await category.evaluate((categoryTemplate) => {
    const list = categoryTemplate.parentElement;
    if (!list) throw new Error("Category list is missing");
    const labels = ["Communication", "Productivity", "Development"];
    labels.forEach((label, index) => {
      const categoryItem = index === 0 ? categoryTemplate : categoryTemplate.cloneNode(true);
      if (!(categoryItem instanceof HTMLAnchorElement)) {
        throw new Error("Category template is incomplete");
      }
      const labelElement = categoryItem.querySelector("span:last-child");
      if (!labelElement) throw new Error("Category label is missing");
      categoryItem.href = `/skills?category=${label.toLowerCase()}`;
      categoryItem.setAttribute("aria-label", `View ${label} skills`);
      labelElement.textContent = label;
      if (index > 0) list.append(categoryItem);
    });
  });
  await expect(categories).toHaveCount(3);

  await topics.first().evaluate((topicTemplate) => {
    const list = topicTemplate.parentElement;
    if (!list) throw new Error("Topic list is missing");
    const labels = ["#video-generation", "#creative-production", "#automation-workflows"];
    labels.forEach((label, index) => {
      const topicItem = index === 0 ? topicTemplate : topicTemplate.cloneNode(true);
      if (!(topicItem instanceof HTMLAnchorElement)) {
        throw new Error("Topic template is incomplete");
      }
      topicItem.href = `/topics/${label.slice(1)}`;
      topicItem.setAttribute("aria-label", `View skills tagged ${label}`);
      topicItem.textContent = label;
      if (index > 0) list.append(topicItem);
    });
  });
  await expect(topics).toHaveCount(3);

  await page.setViewportSize({ width: 320, height: 900 });
  const wrappedGroupTops = await Promise.all(
    [source, category, topics.first()].map(async (locator) => (await locator.boundingBox())?.y),
  );
  expect(wrappedGroupTops.every((top) => top !== undefined)).toBe(true);
  expect(
    Math.max(...(wrappedGroupTops as number[])) - Math.min(...(wrappedGroupTops as number[])),
  ).toBeGreaterThan(1);

  const categoryTops = await categories.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().top)),
  );
  expect(new Set(categoryTops).size).toBeGreaterThan(1);

  const topicTops = await topics.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().top)),
  );
  expect(new Set(topicTops).size).toBeGreaterThan(1);

  const semanticUnitStyles = await taxonomy
    .locator(".skills-sh-sync-source-label, .skill-category-meta-link, .skill-hero-topic")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        rects: element.getClientRects().length,
        whiteSpace: getComputedStyle(element).whiteSpace,
      })),
    );
  expect(
    semanticUnitStyles.every((style) => style.rects === 1 && style.whiteSpace === "nowrap"),
  ).toBe(true);

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  await expectHealthyPage(page, errors);
});

test("removed creators route renders not found", async ({ page }) => {
  await stubExternalMediaInVitePreview(page);
  await page.goto("/creators", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "We couldn't find that page." })).toBeVisible();
});
