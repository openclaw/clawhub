import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { signInAsLocalPersona } from "./helpers";

const exec = promisify(execFile);
test.skip(process.env.VITE_ENABLE_DEV_AUTH !== "1", "Requires the disposable local-auth runner");
test("staff reviews Featured slots, pending reservations and the empty catalog without publishing", async ({
  page,
}, testInfo) => {
  const current = async () =>
    JSON.parse(
      (
        await exec(
          "bunx",
          [
            "convex",
            "run",
            "featuredArtifacts:readCurrentFeaturedInternal",
            '{"artifactKind":"plugin"}',
          ],
          { env: process.env },
        )
      ).stdout,
    ) as Array<{ id: string; featuredAt: number }>;

  await page.goto("/");
  await signInAsLocalPersona(page, "admin");
  await page.goto("/management?view=search-insights");
  await page.getByRole("combobox", { name: "View" }).selectOption("featured");
  await page.getByRole("combobox", { name: "Catalog" }).selectOption("skill");
  // The monthly fixture populates both catalogs, so prove the empty state first.
  await expect(
    page.getByText("0 ready of 16 skills · 0 pending reservations · 16 open telemetry places."),
  ).toBeVisible();
  await expect(page.locator(".featured-recommendation-card")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("featured-lineup-empty.png"), fullPage: true });

  const seed = JSON.parse(
    (
      await exec("bunx", ["convex", "run", "searchInsightsFixtures:seedFeaturedLineup", "{}"], {
        env: process.env,
      })
    ).stdout,
  ) as { actorUserId: string; pluginIds: string[]; skillIds: string[] };
  expect(seed.pluginIds).toHaveLength(20);
  expect(seed.skillIds).toHaveLength(20);
  const before = await current();
  expect(before.map(({ id }) => id).sort()).toEqual([seed.pluginIds[0], seed.pluginIds[16]].sort());
  await page.getByRole("combobox", { name: "Catalog" }).selectOption("plugin");
  await expect(
    page.getByText("13 ready of 16 plugins · 3 pending reservations · 0 open telemetry places."),
  ).toBeVisible();
  await expect(page.locator(".featured-recommendation-card")).toHaveCount(16);
  await expect(page.locator(".featured-recommendation-card.is-pending")).toHaveCount(3);
  await expect(page.locator(".featured-recommendation-card.is-pending a")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Editorial slots · 8 reserved" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Install-ranked selection · 8 of 8" }),
  ).toBeVisible();
  await expect(page.getByText("1 retained · 12 additions · 1 removals proposed.")).toBeVisible();
  const selected = page.locator(".featured-recommendation-card:not(.is-pending) h3 a");
  await expect(selected).toHaveCount(13);
  expect(
    await selected.evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
  ).toEqual(seed.pluginIds.slice(0, 13).map((id) => `/plugins/${id.slice("plugin:".length)}`));
  await page.getByText("Proposed removals (1)", { exact: true }).click();
  await expect(page.getByText("Local monthly tool 17", { exact: true })).toBeVisible();
  for (const [label, width, height] of [
    ["mobile", 390, 844],
    ["tablet", 768, 1024],
    ["laptop", 1366, 768],
    ["desktop", 1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(".featured-recommendation-card")).toHaveCount(16);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`featured-lineup-${label}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("combobox", { name: "Catalog" }).selectOption("skill");
  // Refresh the completed empty snapshot after seeding install evidence.
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("16 ready of 16 skills · 0 pending reservations · 0 open telemetry places."),
  ).toBeVisible();
  await expect(page.locator(".featured-recommendation-card")).toHaveCount(16);
  expect(await current()).toEqual(before);

  // Exercise the existing sixteen-member cap and idempotent keep semantics.
  const feature = (id: string) =>
    exec(
      "bunx",
      [
        "convex",
        "run",
        "packages:setPackageFeaturedForUserInternal",
        JSON.stringify({
          actorUserId: seed.actorUserId,
          name: id.slice("plugin:".length),
          featured: true,
        }),
      ],
      { env: process.env },
    );
  for (const id of seed.pluginIds.slice(1, 15)) await feature(id);
  const full = await current();
  expect(full).toHaveLength(16);
  await expect(feature(seed.pluginIds[15]!)).rejects.toThrow(/Featured is limited to 16 plugins/);
  expect(await current()).toEqual(full);
  await feature(seed.pluginIds[0]!);
  const after = await current();
  expect(after).toEqual(full);
  expect(after.find((entry) => entry.id === seed.pluginIds[0])?.featuredAt).toBe(
    before.find((entry) => entry.id === seed.pluginIds[0])?.featuredAt,
  );
  await testInfo.attach("local-convex-publication-receipt", {
    body: JSON.stringify(
      {
        fixture: "local-only",
        before,
        after,
        rejectedSeventeenth: true,
        reportReadDidNotPublish: true,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
