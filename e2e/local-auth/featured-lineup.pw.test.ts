import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { signInAsLocalPersona } from "./helpers";

const exec = promisify(execFile);
test.skip(process.env.VITE_ENABLE_DEV_AUTH !== "1", "Requires the disposable local-auth runner");
test("staff reviews the complete Featured selection, membership changes and empty catalog without publishing", async ({
  page,
}, testInfo) => {
  const seed = JSON.parse(
    (
      await exec("bunx", ["convex", "run", "searchInsightsFixtures:seedFeaturedLineup", "{}"], {
        env: process.env,
      })
    ).stdout,
  ) as { actorUserId: string };
  const current = async () =>
    JSON.parse(
      (
        await exec(
          "bunx",
          [
            "convex",
            "run",
            "featuredArtifacts:readCurrentFeaturedInternal",
            JSON.stringify({ artifactKind: "plugin" }),
          ],
          { env: process.env },
        )
      ).stdout,
    ) as Array<{ id: string; featuredAt: number }>;
  const before = await current();
  await page.goto("/");
  await signInAsLocalPersona(page, "admin");
  await page.goto("/management?view=search-insights");
  await page.getByRole("combobox", { name: "View" }).selectOption("featured");
  await expect(page.getByText(/Complete proposed Featured set: 8 of 8 plugins/)).toBeVisible();
  await expect(page.locator(".featured-recommendation-card")).toHaveCount(8);
  await expect(page.getByText(/1 retained · 7 additions · 2 removals proposed/)).toBeVisible();
  await expect(page.getByText(/Retain · Emerging · Adoption/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Proposed removals" })).toContainText(
    "Local discovery tool 9",
  );
  for (const [label, width, height] of [
    ["mobile", 390, 844],
    ["tablet", 768, 1024],
    ["laptop", 1366, 768],
    ["desktop", 1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(".featured-recommendation-card")).toHaveCount(8);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`featured-lineup-${label}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("combobox", { name: "Catalog" }).selectOption("skill");
  await expect(page.getByText(/8 open Featured places/)).toBeVisible();
  await expect(page.locator(".featured-recommendation-card")).toHaveCount(0);
  expect(await current()).toEqual(before);
  // Exercise the real moderator mutation and Convex index transaction after
  // proving that report viewing made no publication changes.
  const feature = (name: string) =>
    exec(
      "bunx",
      [
        "convex",
        "run",
        "packages:setPackageFeaturedForUserInternal",
        JSON.stringify({ actorUserId: seed.actorUserId, name, featured: true }),
      ],
      { env: process.env },
    );
  for (let index = 1; index <= 5; index++) await feature(`lineup-tool-${index}`);
  expect(await current()).toHaveLength(8);
  await expect(feature("lineup-tool-6")).rejects.toThrow(/Featured is limited/);
  await feature("lineup-tool-0");
  const after = await current();
  expect(after).toHaveLength(8);
  expect(after.find((entry) => entry.id === "plugin:lineup-tool-0")?.featuredAt).toBe(
    before.find((entry) => entry.id === "plugin:lineup-tool-0")?.featuredAt,
  );
  await testInfo.attach("local-convex-publication-receipt", {
    body: JSON.stringify(
      { fixture: "local-only", before, after, rejectedNinth: true, reportReadDidNotPublish: true },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
