import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { npmPackFixture } from "../../packages/clawhub/test/npmPack";
import { waitForHydration } from "../helpers/runtimeErrors";
import { signInAsLocalPersona } from "./helpers";

test.skip(process.env.VITE_ENABLE_DEV_AUTH !== "1", "Requires the isolated local-auth runner");
// The ephemeral publishing token appears on Settings, never in traces, video or proof images.
test.use({ trace: "off", screenshot: "off", video: "off", colorScheme: "light" });
test.setTimeout(180_000);

const visibilityCopy =
  "Only the publisher and ClawHub staff can see this release. Once it’s published, anyone can view and install it.";
const notFound = "We couldn't find that page.";
const summary =
  "Keep a pair programming session focused with a shared plan, decision notes, and a handoff for the next session.";
const proofDir = process.env.TEMPLATE_LISTING_PROOF_DIR;
const sizes = [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
] as const;

async function capture(page: Page, label: string) {
  if (!proofDir) return;
  await mkdir(proofDir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(proofDir, label + ".png"), animations: "disabled" });
}

async function createPublisherToken(page: Page) {
  await page.goto("/settings?view=tokens");
  await waitForHydration(page);
  await page.locator("#settings-token-label").fill("Local Template publishing");
  await page.getByRole("button", { name: "Create token" }).click();
  const value = await page
    .getByText(/Copy this token now/u)
    .locator("..")
    .getByRole("code")
    .innerText();
  await page.goto("/dashboard");
  return value.trim();
}

async function submit(
  request: APIRequestContext,
  registry: string,
  token: string,
  fixture: {
    handle: string;
    slug: string;
    version: string;
    displayName: string;
  },
) {
  const { handle, slug, version, displayName } = fixture;
  const name = "@" + handle + "/" + slug;
  const bytes = Buffer.from(
    npmPackFixture({
      "package/package.json": JSON.stringify({
        name,
        version,
        description: summary,
        openclaw: { template: "CLAW.md" },
      }),
      "package/CLAW.md": [
        "---",
        JSON.stringify({
          schemaVersion: 1,
          agent: { id: slug, name: displayName, description: summary },
        }),
        "---",
        "## Session brief",
        "",
        "Agree on the goal, break the work into small steps, and record decisions as you go.",
        "",
      ].join("\n"),
    }),
  );
  const sha = createHash("sha256").update(bytes).digest("hex");
  const response = await request.post(registry + "/api/v1/packages", {
    headers: { Authorization: "Bearer " + token },
    multipart: {
      payload: JSON.stringify({
        name,
        ownerHandle: handle,
        displayName,
        family: "template",
        version,
        changelog: "First session brief.",
        tags: ["latest"],
        expectedArtifactSha256: sha,
      }),
      clawpack: { name: slug + ".tgz", mimeType: "application/octet-stream", buffer: bytes },
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  const receipt = await response.json();
  expect(receipt).toMatchObject({
    attemptId: expect.any(String),
    publicationStatus: "pending",
    artifactSha256: sha,
  });
  console.log("Local pending Template:", name, version, receipt.attemptId, sha);
  return "/" + handle + "/templates/" + slug;
}

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
}

async function checkPlacement(page: Page, version: string, published = false) {
  const heading = page.getByText("Version " + version + " is under review", { exact: true });
  const identity = published
    ? page.locator("main .catalog-detail__publisher a")
    : page.getByRole("main").getByRole("link", { name: /view local user profile/i });
  const notice = page.getByRole("status").filter({ has: heading });
  await expect(notice.getByText(visibilityCopy, { exact: true })).toBeVisible();
  // The real local-user persona has no email, even when it submitted this version.
  await expect(notice).not.toContainText(/email/i);
  const identityBox = await bounds(identity);
  const noticeBox = await bounds(notice);
  expect(noticeBox.y).toBeGreaterThanOrEqual(identityBox.y + identityBox.height);
  // The profile link extends past the visual edge for its hover/focus target.
  const titleBox = await bounds(
    published
      ? page.locator(".catalog-detail__main")
      : page.locator("main header").getByRole("heading", { level: 1 }),
  );
  expect(Math.abs(noticeBox.x - titleBox.x)).toBeLessThanOrEqual(2);
  if (!published) expect(Math.abs(noticeBox.x - identityBox.x)).toBeLessThanOrEqual(8);
  const tabsBox = await bounds(
    published
      ? page.getByRole("region", { name: "Included in this release" })
      : page.getByRole("tablist", { name: "Template contents" }),
  );
  expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(tabsBox.y);
  expect(Math.abs(noticeBox.x - tabsBox.x)).toBeLessThanOrEqual(2);
  // Compare actual rendered color channels, not class names or a specific theme token.
  const [red, green, blue] = await notice.evaluate((element) => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  });
  expect(red).toBeGreaterThanOrEqual(green!);
  expect(green).toBeGreaterThan(blue!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("a pending Template stays on its publisher URL without changing the public release", async ({
  page,
  browser,
  request,
  baseURL,
}, testInfo) => {
  const registry = process.env.VITE_CONVEX_SITE_URL!;
  for (const url of [registry, baseURL!, process.env.VITE_CONVEX_URL!]) {
    expect(new URL(url).hostname).toBe("127.0.0.1");
  }
  const handle = await signInAsLocalPersona(page, "user");
  const token = await createPublisherToken(page);
  const slug =
    "pair-programming-chief-of-staff" + (testInfo.retry ? "-retry-" + testInfo.retry : "");
  const displayName = "Pair Programming Chief of Staff";
  const route = await submit(request, registry, token, {
    handle,
    slug,
    version: "0.1.0",
    displayName,
  });
  const publicContext = await browser.newContext({ baseURL, colorScheme: "light" });
  try {
    const visitor = await publicContext.newPage();
    await visitor.setViewportSize({ width: 1440, height: 900 });
    const submission = route + "?view=submission";
    await page.goto(submission);
    await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
    await expect(page).toHaveURL(new URL(submission, baseURL).href);
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await checkPlacement(page, "0.1.0");
      await expect(page.getByRole("tab")).toHaveText([
        "CLAW.md",
        "Skills",
        "Automations",
        "Plugins",
        "Workspace files",
      ]);
      const preview = page.getByRole("main");
      await expect(preview.getByRole("region", { name: "Install Template" })).toHaveCount(0);
      await expect(
        preview.getByRole("link", { name: /install|download|open in|view file/i }),
      ).toHaveCount(0);
      await expect(
        preview.getByRole("button", { name: /copy|install|download|open in/i }),
      ).toHaveCount(0);
      await expect(preview).not.toContainText("Agree on the goal, break the work into small steps");
      await capture(page, label);
    }
    // These are real navigation controls, not access to the staged contents.
    for (const tab of await page.getByRole("tab").all()) {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel")).toHaveText(
        "Release contents will be available after publication.",
      );
      await expect(page.getByRole("tabpanel").getByRole("link")).toHaveCount(0);
    }
    const hidden = await visitor.goto(route);
    expect(hidden?.status()).toBe(404);
    expect(await hidden!.text()).not.toContain(displayName);
    await expect(visitor.getByRole("heading", { name: notFound })).toBeVisible();
    await expect(visitor.getByText(visibilityCopy)).toHaveCount(0);
    if (proofDir) {
      await visitor
        .getByRole("img", { name: /lobster detective/i })
        .evaluate((image: HTMLImageElement) => image.decode());
      await capture(visitor, "visitor-not-found");
    }
    // The hint comes from the click, not the registry: absent and pending names look identical.
    const signIn = visitor.getByRole("main").getByRole("button", { name: "Sign in with GitHub" });
    let signInCopy: string | undefined;
    for (const href of [submission, route + "-missing?view=submission"]) {
      expect((await visitor.goto(href))?.status()).toBe(404);
      await expect(signIn).toBeVisible();
      const copy = await visitor.getByRole("main").innerText();
      expect(copy).not.toContain(displayName);
      if (signInCopy === undefined) {
        signInCopy = copy;
        await capture(visitor, "submission-sign-in");
      } else expect(copy).toBe(signInCopy);
    }
    const other = await browser.newContext({ baseURL });
    try {
      const wrongAccount = await other.newPage();
      await signInAsLocalPersona(wrongAccount, "officialOrgMember");
      for (const href of [submission, route + "-missing?view=submission"]) {
        await wrongAccount.goto(href);
        await expect(wrongAccount.getByRole("heading", { name: notFound })).toBeVisible();
        await expect(wrongAccount.getByText(displayName)).toHaveCount(0);
      }
    } finally {
      await other.close();
    }
    const apiPath = registry + "/api/v1/packages/" + encodeURIComponent("@" + handle + "/" + slug);
    expect((await publicContext.request.get(apiPath)).status()).toBe(404);
    for (const suffix of [
      "/file?path=CLAW.md&version=0.1.0&preview=1",
      "/versions/0.1.0/artifact/download",
    ]) {
      expect((await publicContext.request.get(apiPath + suffix)).status()).toBe(404);
    }

    // Hopper already has a public 0.1.0 in the supported local dashboard fixture; no
    // simulated scanner completion, external service, or hand-edited DB state is needed.
    const hopperApi = registry + "/api/v1/packages/" + encodeURIComponent("@" + handle + "/hopper");
    if ((await publicContext.request.get(hopperApi)).status() === 404) {
      execFileSync(
        "bunx",
        [
          "convex",
          "run",
          "--no-push",
          "--typecheck",
          "disable",
          "--codegen",
          "disable",
          "devSeed:seedDashboardTemplateFixture",
          "{}",
        ],
        { stdio: "pipe" },
      );
    }
    const version = "0.2." + testInfo.retry;
    const update = await submit(request, registry, token, {
      handle,
      slug: "hopper",
      version,
      displayName: "Hopper session planner",
    });
    const published = await visitor.goto(update + "?view=submission");
    expect(published?.status()).toBe(200);
    await expect(
      visitor.locator("main header").getByRole("heading", { name: "Hopper", level: 1 }),
    ).toBeVisible();
    await expect(
      visitor.getByRole("complementary").getByText("0.1.0", { exact: true }),
    ).toBeVisible();
    await expect(visitor.getByText("Help the user organize their work.")).toBeVisible();
    await expect(visitor.getByText(visibilityCopy)).toHaveCount(0);
    await expect(visitor.getByText("Hopper session planner")).toHaveCount(0);
    await expect(visitor.getByText("Version " + version + " is under review")).toHaveCount(0);
    await capture(visitor, "visitor-published");
    const publicDetail = await publicContext.request.get(hopperApi);
    expect(publicDetail.status()).toBe(200);
    expect(await publicDetail.json()).toMatchObject({ package: { latestVersion: "0.1.0" } });
    await page.goto(update);
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await checkPlacement(page, version, true);
      await capture(page, "update-" + label);
    }
  } finally {
    await publicContext.close();
  }
});
