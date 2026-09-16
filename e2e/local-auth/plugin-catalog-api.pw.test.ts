import { expect, test } from "@playwright/test";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth plugin catalog API tests require the local dev auth runner",
);

test("plugin category browse API handles official-first scan-status exclusions", async ({
  request,
}) => {
  const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL;
  expect(convexSiteUrl, "VITE_CONVEX_SITE_URL is required").toBeTruthy();

  const url = new URL("/api/v1/plugins", convexSiteUrl);
  url.searchParams.set("limit", "25");
  url.searchParams.set("category", "security");
  url.searchParams.set("officialFirst", "true");
  url.searchParams.set("sort", "downloads");
  url.searchParams.set("excludeScanStatus", "pending,suspicious");

  const response = await request.get(url.toString(), {
    headers: { Accept: "application/json" },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const json = (await response.json()) as { items?: unknown[]; nextCursor?: string | null };
  expect(Array.isArray(json.items)).toBe(true);
  expect(json.nextCursor).toBeNull();
});

test("plugin categories API exposes the canonical OpenClaw taxonomy", async ({ request }) => {
  const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL;
  expect(convexSiteUrl, "VITE_CONVEX_SITE_URL is required").toBeTruthy();

  const response = await request.get(
    new URL("/api/v1/plugins/categories", convexSiteUrl).toString(),
    {
      headers: { Accept: "application/json" },
    },
  );

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const json = (await response.json()) as {
    categories?: Array<{
      description?: string;
      icon?: string;
      label?: string;
      order?: number;
      slug?: string;
    }>;
  };
  expect(json.categories?.map((category) => category.slug)).toEqual([
    "channels",
    "models",
    "agent-runtimes",
    "memory",
    "context",
    "voice",
    "web",
    "media",
    "security",
    "integrations",
    "developer-tools",
    "infrastructure",
    "documents-files",
    "inbox-collaboration",
    "productivity",
    "scheduling",
    "finance-payments",
    "sales-marketing",
    "data-analytics",
    "agent-orchestration",
    "research",
    "other",
  ]);
  expect(json.categories?.[0]).toEqual({
    slug: "channels",
    label: "Channels",
    description: expect.any(String),
    icon: "message-circle",
    order: 0,
  });
});

test("plugin browse exposes product categories and keeps mobile filtering usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto("/plugins");
  const categories = page.getByLabel("Plugin categories");
  await expect(categories).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("categories-desktop.png"), fullPage: true });
  await expect(categories.getByRole("button")).toHaveCount(23);
  await expect(
    categories.getByRole("button", { name: "Documents & files", exact: true }),
  ).toBeVisible();
  const scheduling = categories.getByRole("button", { name: "Scheduling", exact: true });
  await expect(scheduling.locator("svg.lucide-calendar-days")).toBeVisible();
  await scheduling.click();
  await expect(page).toHaveURL(/category=scheduling/);
  await page.setViewportSize({ width: 390, height: 844 });
  const select = page.getByRole("combobox", { name: "Category" });
  await expect(select).toBeVisible();
  await expect(select).toContainText("Scheduling");
  await select.click();
  await page.getByRole("searchbox", { name: "Search categories" }).fill("Research");
  await expect(page.getByRole("radio", { name: "Research", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Research", exact: true }).click();
  await expect(page).toHaveURL(/category=research/);
  await expect(select).toContainText("Research");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("categories-mobile.png"), fullPage: true });
});
