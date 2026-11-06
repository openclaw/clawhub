import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import convexBrowser from "convex/browser";
import { api } from "../../convex/_generated/api";
import { encodePublicPageCursor } from "../../convex/lib/packagePageCursor";

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
    "computer-use",
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
    pinnedPackages: [
      "@openclaw/telegram",
      "@openclaw/whatsapp",
      "@openclaw/discord",
      "@openclaw/slack",
      "@openclaw/feishu",
      "@openclaw/qqbot",
    ],
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
  await expect(categories.getByRole("button")).toHaveCount(24);
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

test("category digest sorts preserve scope, order, and pagination on local Convex", async () => {
  test.setTimeout(180_000);
  const convexUrl = process.env.VITE_CONVEX_URL!;
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(convexUrl).hostname);
  const { deploymentName } = JSON.parse(
    readFileSync(".convex/local/default/config.json", "utf8"),
  ) as {
    deploymentName: string;
  };
  const env = { ...process.env, CONVEX_DEPLOYMENT: `local:${deploymentName}` };
  const client = new convexBrowser.ConvexHttpClient(convexUrl);
  const exec = promisify(execFile);
  const run = async <T>(args: string[]): Promise<T> => {
    const result = await exec("bunx", ["convex", "run", "--no-push", ...args], { env });
    return JSON.parse(result.stdout);
  };
  const handle = `category-sort-${Date.now()}`;
  const fixtures = (["code-plugin", "bundle-plugin"] as const).flatMap((family) =>
    (["community", "official"] as const).flatMap((channel) =>
      [0, 1].map((rank) => ({
        kind: "plugin",
        name: `${handle}-${family}-${channel}-${rank}`,
        displayName: "Category sort fixture",
        version: "1.0.0",
        readme: "# Category sort fixture",
        categories: ["security"],
        family,
        channel,
        dummyOwner: { handle, displayName: handle, image: "" },
      })),
    ),
  );
  const fixtureNames = new Set(fixtures.map((row) => row.name));
  const unrelated = { ...fixtures[0], name: `${handle}-unrelated` };
  await run(["devSeed:seedPublicCorpusBatch", JSON.stringify({ rows: [...fixtures, unrelated] })]);
  try {
    const rows = await run<
      Array<{
        name: string;
        family: string;
        channel: string;
        isOfficial: boolean;
        stats: { installs: number };
        recommendedScore: number;
        updatedAt: number;
        _creationTime: number;
      }>
    >([
      "--inline-query",
      `
      return await Promise.all(${JSON.stringify(fixtures.map((row) => row.name))}.map(async name => {
        const pkg = await ctx.db.query("packages")
          .withIndex("by_name", q => q.eq("normalizedName", name)).unique();
        return await ctx.db.query("packagePluginCategorySearchDigest")
          .withIndex("by_package", q => q.eq("packageId", pkg._id).eq("pluginCategory", "security")).unique();
      }));
    `,
    ]);
    for (const sort of ["installs", "recommended"] as const) {
      for (const family of [undefined, "code-plugin"] as const) {
        for (const isOfficial of [undefined, false, true]) {
          for (const channel of [undefined, "community", "official"] as const) {
            const expected = rows
              .filter(
                (row) =>
                  (!family || row.family === family) &&
                  (isOfficial === undefined || row.isOfficial === isOfficial) &&
                  (!channel || row.channel === channel),
              )
              .sort(
                (a, b) =>
                  (sort === "installs"
                    ? b.stats.installs - a.stats.installs
                    : b.recommendedScore - a.recommendedScore) ||
                  b.updatedAt - a.updatedAt ||
                  b._creationTime - a._creationTime,
              )
              .map((row) => row.name);
            const names: string[] = [];
            let cursor = encodePublicPageCursor({
              cursor: null,
              offset: 0,
              pageSize: 2,
              done: false,
              mode: "digest",
              sort,
            });
            for (let page = 0; page < 100 && cursor; page += 1) {
              const result = await client.query(api.packages.listPublicPage, {
                category: "security",
                family,
                isOfficial,
                channel,
                sort,
                paginationOpts: { cursor, numItems: 2 },
              });
              names.push(
                ...result.page.map((row) => row.name).filter((name) => fixtureNames.has(name)),
              );
              cursor = result.continueCursor;
              if (result.isDone) {
                cursor = "";
                break;
              }
            }
            expect(cursor, "category pagination must finish within 100 pages").toBe("");
            expect(names, JSON.stringify({ sort, family, isOfficial, channel })).toEqual(expected);
          }
        }
      }
    }
  } finally {
    await run([
      "devSeed:seedPublicCorpusBatch",
      JSON.stringify({
        reset: true,
        resetOwnerHandles: [handle],
        rows: [],
      }),
    ]);
  }
});
