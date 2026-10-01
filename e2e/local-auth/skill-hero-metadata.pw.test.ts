import { expect, test } from "@playwright/test";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "../helpers/runtimeErrors";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "skill hero metadata tests require the local dev auth runner",
);

test("skill hero metadata keeps semantic wrap groups on mobile", async ({ page }) => {
  const errors = trackRuntimeErrors(page);
  await page.route("**/_vercel/image?**", (route) => route.fulfill({ status: 204 }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/skills-sh/doany-skills/skills/reddit-automation", {
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
  const secondaryColor = await creatorHandle.evaluate((handleElement) => {
    const secondaryProbe = document.createElement("span");
    secondaryProbe.style.color = "var(--ink-soft)";
    handleElement.parentElement!.append(secondaryProbe);
    const color = getComputedStyle(secondaryProbe).color;
    secondaryProbe.remove();
    return color;
  });
  // Hydration can start a theme color transition; wait for its observable result.
  await expect(creatorHandle).toHaveCSS("color", secondaryColor);
  await expect(creatorName).not.toHaveCSS("color", secondaryColor);
  await expect(taxonomy.locator(".skill-hero-taxonomy-separator").first()).not.toHaveCSS(
    "display",
    "none",
  );

  await page.setViewportSize({ width: 600, height: 900 });
  // Flex items compute inline-flex as flex; prove their layout instead of the authored keyword.
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
    list.replaceChildren(categoryTemplate);
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
    list.replaceChildren(topicTemplate);
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
