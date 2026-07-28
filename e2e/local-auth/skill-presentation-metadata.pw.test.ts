import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { waitForHydration } from "../helpers/runtimeErrors";
import { publishSkillVersion, signInAsLocalPublisher, skillMd } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "skill presentation metadata tests require the local dev auth runner",
);

test.setTimeout(600_000);

const iconBytes = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

test("agents/openai.yaml drives hosted skill presentation in UI and feed", async ({
  page,
}, testInfo) => {
  await signInAsLocalPublisher(page, "officialOrgMember");
  const ownerHandle = "local-official-org";
  const slug = `pw-presentation-${Date.now().toString(36)}`;
  const version = "1.0.0";

  await publishSkillVersion(page, testInfo, {
    ownerHandle,
    slug,
    displayName: "Presentation Fixture",
    expectedDisplayName: "OpenAI Presentation Fixture",
    version,
    versionLabel: "presentation metadata release",
    changelog: "Verify normalized presentation metadata and hosted icon delivery.",
    skillMarkdown: skillMd({
      slug,
      displayName: "Presentation Fixture",
      versionLabel: "presentation metadata release",
    }).replace(`name: ${slug}`, "name: Presentation Fixture"),
    files: [
      {
        path: "agents/openai.yaml",
        contents:
          "interface:\n  display_name: '✨ OpenAI Presentation Fixture'\n  short_description: Feed-ready OpenAI summary.\n  icon_small: assets/icon.png\n",
      },
      { path: "assets/icon.png", contents: iconBytes },
    ],
  });

  await waitForHydration(page);
  await expect(page.locator("h1.skill-page-title")).toHaveText("OpenAI Presentation Fixture");
  await expect(page.getByText("Feed-ready OpenAI summary.")).toBeVisible();
  const icon = page.locator(".skill-hero-title-row img.marketplace-icon-image");
  await expect(icon).toBeVisible();
  await expect
    .poll(() =>
      icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  const iconUrl = await icon.getAttribute("src");
  expect(iconUrl).toMatch(/^\/api\/v1\/skill-icons\/[a-f\d]{64}$/);

  const iconResponse = await page.request.get(new URL(iconUrl!, page.url()).toString());
  expect(iconResponse.status()).toBe(200);
  expect(new Uint8Array(await iconResponse.body())).toEqual(iconBytes);
  expect(iconResponse.headers()["cache-control"]).toContain("immutable");

  markLatestVersionDownloadableForLocalFeed(ownerHandle, slug);
  publishCatalogFeeds();
  const feedResponse = await page.request.get(`${convexSiteUrl()}/api/v1/feeds/skills`);
  expect(feedResponse.status()).toBe(200);
  const feed = (await feedResponse.json()) as {
    entries: Array<{ id: string; title?: string; description?: string; icon?: string }>;
  };
  expect(feed.entries).toContainEqual(
    expect.objectContaining({
      id: `@${ownerHandle}/${slug}`,
      title: "OpenAI Presentation Fixture",
      description: "Feed-ready OpenAI summary.",
      icon: expect.stringMatching(/^https:\/\/clawhub\.ai\/api\/v1\/skill-icons\/[a-f\d]{64}$/),
    }),
  );
});

function convexSiteUrl() {
  const url = process.env.VITE_CONVEX_SITE_URL;
  if (!url) throw new Error("VITE_CONVEX_SITE_URL is required");
  return url.replace(/\/$/u, "");
}

function publishCatalogFeeds() {
  runLocalConvex("catalogFeed:publish", {
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

function markLatestVersionDownloadableForLocalFeed(ownerHandle: string, slug: string) {
  const result = runLocalConvex("skills:getBySlug", { ownerHandle, slug }) as {
    latestVersion?: { _id?: string } | null;
  };
  const versionId = result.latestVersion?._id;
  if (!versionId) throw new Error("Published skill version was not available");
  runLocalConvex("skills:updateVersionScanResultsInternal", {
    versionId,
    sha256hash: "a".repeat(64),
  });
}

function runLocalConvex(functionName: string, args: Record<string, unknown>) {
  const config = JSON.parse(readFileSync(".convex/local/default/config.json", "utf8")) as {
    deploymentName?: string;
  };
  if (!config.deploymentName) throw new Error("Local Convex deployment name was not available");
  const result = spawnSync(
    "bunx",
    [
      "convex",
      "run",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      functionName,
      JSON.stringify(args),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CONVEX_DEPLOYMENT: `local:${config.deploymentName}` },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`Convex function ${functionName} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim() ? (JSON.parse(result.stdout) as unknown) : null;
}
