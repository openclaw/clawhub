import { writeFile } from "node:fs/promises";
import { expect, type APIRequestContext, type Page, test, type TestInfo } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import {
  expectNoFatalErrorUi,
  expectNoRuntimeErrors,
  recoverFromTransientErrorScreen,
  trackRuntimeErrors,
  waitForHydration,
} from "../helpers/runtimeErrors";
import {
  buildPluginDetailHref,
  buildPluginValidationHref,
  claimMockPrePublicationChecks,
  completeMockPrePublicationChecks,
  escapeRegExp,
  signInAsLocalPersona,
} from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth plugin inspector tests require the local dev auth runner",
);

test.setTimeout(600_000);

if (process.env.CLAWHUB_CAPTURE_PLUGIN_INSPECTOR_PROOF === "1") {
  test.use({ video: "on" });
}

type PluginFixtureKind = "hard-error" | "warning";

function pluginPackageJson(args: { name: string; displayName: string; kind: PluginFixtureKind }) {
  const pluginInspector =
    args.kind === "hard-error"
      ? { version: 1, plugin: { id: "invalid.fixture.id" } }
      : { version: 1, plugin: { id: args.name, sourceRoot: "dist" } };
  return JSON.stringify(
    {
      name: args.name,
      version: "1.0.0",
      type: "module",
      main: "dist/index.js",
      repository: `https://github.com/openclaw/${args.name}.git`,
      pluginInspector,
      openclaw: {
        extensions: ["./dist/index.js"],
        compat: { pluginApi: ">=2026.3.24-beta.2" },
        build: { openclawVersion: "2026.3.24-beta.2" },
      },
    },
    null,
    2,
  );
}

async function writePluginZip(
  testInfo: TestInfo,
  args: {
    name: string;
    displayName: string;
    kind: PluginFixtureKind;
  },
) {
  const entrypoint =
    args.kind === "warning"
      ? 'export function activate(api) { api.on("before_agent_start", () => {}); }\n'
      : "export const demo = true;\n";
  const zipBytes = zipSync({
    [`${args.name}/package.json`]: strToU8(pluginPackageJson(args)),
    [`${args.name}/openclaw.plugin.json`]: strToU8(
      JSON.stringify(
        {
          id: args.name,
          name: args.displayName,
          configSchema: { type: "object", additionalProperties: false },
        },
        null,
        2,
      ),
    ),
    [`${args.name}/dist/index.js`]: strToU8(entrypoint),
    [`${args.name}/README.md`]: strToU8(`# ${args.displayName}\n\nLocal Playwright fixture.\n`),
  });
  const zipPath = testInfo.outputPath(`${args.name}.zip`);
  await writeFile(zipPath, zipBytes);
  return zipPath;
}

async function uploadPluginZip(page: Page, zipPath: string) {
  await recoverFromTransientErrorScreen(page);
  await page.locator('input[type="file"]').first().setInputFiles(zipPath);
  await waitForHydration(page);
  await recoverFromTransientErrorScreen(page);
}

async function captureProof(page: Page, testInfo: TestInfo, name: string) {
  if (process.env.CLAWHUB_CAPTURE_PLUGIN_INSPECTOR_PROOF !== "1") return;
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

function sawTransientUploadFailure(errors: string[]) {
  return errors.some(
    (error) =>
      error.includes("CONVEX M(uploads:generateUploadUrl)") &&
      (error.includes("Function execution timed out (maximum duration: 1s)") ||
        error.includes("Unauthorized")),
  );
}

const LOCAL_PACKAGE_API_URL_PATTERN =
  /http:\/\/127\.0\.0\.1(?::\d+)?\/api\/v1\/packages\/[^'"\s)]+/u;

function localPackageApiUrl(error: string) {
  return error.match(LOCAL_PACKAGE_API_URL_PATTERN)?.[0] ?? null;
}

async function expectHealthyInspectorPage(page: Page, errors: string[]) {
  const expectedTransientTimeouts = [
    "CONVEX Q(packages:canDeleteVersions)",
    "CONVEX Q(packages:getActivityTrendForName)",
    "CONVEX Q(packages:getManageContext)",
    "CONVEX Q(packages:getPackageInspectorValidationSummaryPublic)",
    "CONVEX Q(packages:list)",
    "CONVEX Q(publishers:getByHandle)",
    "CONVEX Q(publishers:getMyProfileHandle)",
    "CONVEX Q(publishers:listMine)",
    "CONVEX Q(users:me)",
  ];
  const localPackageApiCorsUrls = new Set(
    errors
      .filter((error) => error.includes("CORS policy"))
      .map(localPackageApiUrl)
      .filter((url): url is string => Boolean(url)),
  );
  const shouldIgnoreLocalPackageApiFetchFailure = (error: string) => {
    const corsUrl = localPackageApiUrl(error);
    if (corsUrl && localPackageApiCorsUrls.has(corsUrl) && error.includes("CORS policy")) {
      return true;
    }
    if (
      localPackageApiCorsUrls.size > 0 &&
      error.includes("console:TypeError: Failed to fetch") &&
      error.includes("packageApi-")
    ) {
      return true;
    }
    if (
      corsUrl &&
      localPackageApiCorsUrls.has(corsUrl) &&
      error.startsWith("console:Failed to load resource: net::ERR_FAILED")
    ) {
      return true;
    }
    return false;
  };
  const sawHttpRateLimitTimeout = errors.some(
    (error) =>
      error.includes("Function execution timed out (maximum duration: 1s)") &&
      (error.includes("touchRateLimitKeyMetadata") ||
        error.includes("checkRateLimit") ||
        error.includes("httpRouteRateLimit")),
  );
  await recoverFromTransientErrorScreen(page);
  await expectNoFatalErrorUi(page);
  await expectNoRuntimeErrors(
    page,
    errors.filter(
      (error) =>
        !(
          error.includes("Function execution timed out (maximum duration: 1s)") &&
          expectedTransientTimeouts.some((functionName) => error.includes(functionName))
        ) &&
        !(
          error.includes("CONVEX A(packages:publishRelease)") &&
          error.includes("Version ") &&
          error.includes(" already exists")
        ) &&
        !(
          sawHttpRateLimitTimeout &&
          (error.includes("Function execution timed out (maximum duration: 1s)") ||
            error.includes("ErrorBoundary caught") ||
            error.includes("pageerror:Minified React error #422") ||
            error.includes("pageerror:Minified React error #520") ||
            error.startsWith(
              "console:Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
            ) ||
            error.startsWith(
              "console:Failed to load resource: the server responded with a status of 404 (Not Found)",
            ))
        ) &&
        !shouldIgnoreLocalPackageApiFetchFailure(error),
    ),
  );
}

async function expectDashboardWarningReview(page: Page, warningName: string) {
  const dashboardWarningRow = page
    .locator("button.dashboard-attention-row")
    .filter({ hasText: new RegExp(escapeRegExp(warningName), "i") });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await recoverFromTransientErrorScreen(page);
    try {
      await expect(dashboardWarningRow).toBeVisible({ timeout: 30_000 });
      await dashboardWarningRow.click();
      const reviewDialog = page.getByRole("dialog", { name: /review$/i });
      await expect(reviewDialog).toBeVisible();
      await expect(reviewDialog.getByRole("heading", { name: "Validation" })).toBeVisible();
      return;
    } catch (error) {
      if (attempt >= 3) throw error;
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  throw new Error(`Dashboard review did not appear for ${warningName}`);
}

async function expectValidationSectionVisible(page: Page, warningName: string) {
  const detailHref = buildPluginValidationHref(warningName);
  const validationSection = page.locator("#validation");

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await waitForHydration(page).catch(() => {});
    await recoverFromTransientErrorScreen(page);
    if ((await validationSection.count()) > 0) {
      await expect(validationSection).toBeVisible({ timeout: 10_000 });
      return;
    }
    await page.goto(detailHref, { waitUntil: "domcontentloaded" });
    await waitForHydration(page).catch(() => {});
    await recoverFromTransientErrorScreen(page);
    await page.waitForTimeout(500 * attempt);
  }

  await expect(validationSection).toBeVisible({ timeout: 10_000 });
}

async function publicPackageVersionExists(
  request: APIRequestContext,
  name: string,
  version: string,
) {
  const siteUrl = process.env.VITE_CONVEX_SITE_URL;
  if (!siteUrl) throw new Error("VITE_CONVEX_SITE_URL is required");
  const url = `${siteUrl.replace(/\/$/u, "")}/api/v1/packages/${encodeURIComponent(
    name,
  )}/versions/${encodeURIComponent(version)}`;
  const response = await request.get(url, { timeout: 2_000 }).catch(() => null);
  if (!response?.ok()) return false;
  const body = (await response.json().catch(() => null)) as {
    package?: { name?: unknown };
    version?: { version?: unknown };
  } | null;
  return body?.package?.name === name && body?.version?.version === version;
}

async function publishWarningPluginWithRetry(args: {
  errors: string[];
  page: Page;
  suffix: string;
  testInfo: TestInfo;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const attemptSuffix = attempt === 0 ? args.suffix : `${args.suffix}-${attempt + 1}`;
    const warningName = `pw-inspector-warning-${attemptSuffix}`;
    const warningDisplayName = `Playwright Inspector Warning Plugin ${attemptSuffix}`;
    args.errors.length = 0;

    try {
      if (attempt > 0) await signInAsLocalPersona(args.page, "admin");
      await args.page.goto("/plugins/publish", { waitUntil: "domcontentloaded" });
      await waitForHydration(args.page);
      await recoverFromTransientErrorScreen(args.page);
      await uploadPluginZip(
        args.page,
        await writePluginZip(args.testInfo, {
          name: warningName,
          displayName: warningDisplayName,
          kind: "warning",
        }),
      );
      await expect(args.page.locator("#pluginName")).toHaveValue(warningName);
      await args.page.locator("#pluginSourceCommit").fill("abc123");
      const publishButton = args.page.getByRole("button", { name: "Publish plugin" });
      await expect(publishButton).toBeEnabled({ timeout: 60_000 });
      await publishButton.click({ timeout: 15_000 });
      const claim = await claimMockPrePublicationChecks({
        kind: "package",
        slug: warningName,
        version: "1.0.0",
      });
      await completeMockPrePublicationChecks({
        kind: "package",
        slug: warningName,
        version: "1.0.0",
        claim,
      });
      return { warningDisplayName, warningName };
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      await args.page.waitForTimeout(1_000);
    }
  }
  throw lastError;
}

async function publishHardErrorPluginWithRetry(args: {
  errors: string[];
  page: Page;
  suffix: string;
  testInfo: TestInfo;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const attemptSuffix = attempt === 0 ? args.suffix : `${args.suffix}-${attempt + 1}`;
    const badName = `pw-inspector-bad-${attemptSuffix}`;
    args.errors.length = 0;

    try {
      if (attempt > 0) await signInAsLocalPersona(args.page, "admin");
      await args.page.goto("/plugins/publish", { waitUntil: "domcontentloaded" });
      await waitForHydration(args.page);
      await recoverFromTransientErrorScreen(args.page);
      await uploadPluginZip(
        args.page,
        await writePluginZip(args.testInfo, {
          name: badName,
          displayName: "Playwright Inspector Bad Plugin",
          kind: "hard-error",
        }),
      );
      await expect(args.page.locator("#pluginName")).toHaveValue(badName);
      await args.page.locator("#pluginSourceCommit").fill("abc123");
      const publishButton = args.page.getByRole("button", { name: "Publish plugin" });
      await expect(publishButton).toBeEnabled({ timeout: 60_000 });
      await publishButton.click({ timeout: 15_000 });
      await expect(args.page.getByRole("alert")).toContainText("Plugin Inspector blocked publish", {
        timeout: 60_000,
      });
      return { badName };
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      await args.page.waitForTimeout(sawTransientUploadFailure(args.errors) ? 1_000 : 2_000);
    }
  }
  throw lastError;
}

test("plugin publish stays private until mocked TruffleHog and ClawScan pass", async ({
  page,
  request,
}, testInfo) => {
  const errors = trackRuntimeErrors(page, { includeConsoleLocation: true });
  const suffix = Date.now().toString(36);
  const name = `pw-staged-plugin-${suffix}`;
  const displayName = `Playwright Staged Plugin ${suffix}`;
  const version = "1.0.0";

  await signInAsLocalPersona(page, "admin");
  await page.goto("/plugins/publish", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await recoverFromTransientErrorScreen(page);
  await uploadPluginZip(
    page,
    await writePluginZip(testInfo, {
      name,
      displayName,
      kind: "warning",
    }),
  );
  await expect(page.locator("#pluginName")).toHaveValue(name);
  await page.locator("#pluginSourceCommit").fill("abc123");
  const publishButton = page.getByRole("button", { name: "Publish plugin" });
  await expect(publishButton).toBeEnabled({ timeout: 60_000 });
  await publishButton.click({ timeout: 15_000 });
  const claim = await claimMockPrePublicationChecks({
    kind: "package",
    slug: name,
    version,
  });

  await expect(await publicPackageVersionExists(request, name, version)).toBe(false);
  await completeMockPrePublicationChecks({
    kind: "package",
    slug: name,
    version,
    claim,
  });
  await expect
    .poll(() => publicPackageVersionExists(request, name, version), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(true);

  await page.goto(buildPluginDetailHref(name), { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await recoverFromTransientErrorScreen(page);
  await expect(page.locator("h1.skill-page-title", { hasText: displayName })).toBeVisible({
    timeout: 30_000,
  });
  await expectHealthyInspectorPage(page, errors);
});

test("malicious ClawScan verdict keeps a staged plugin private", async ({
  page,
  request,
}, testInfo) => {
  const errors = trackRuntimeErrors(page, { includeConsoleLocation: true });
  const suffix = Date.now().toString(36);
  const name = `pw-malicious-plugin-${suffix}`;
  const displayName = `Playwright Malicious Plugin ${suffix}`;
  const version = "1.0.0";

  await signInAsLocalPersona(page, "admin");
  await page.goto("/plugins/publish", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await recoverFromTransientErrorScreen(page);
  await uploadPluginZip(
    page,
    await writePluginZip(testInfo, {
      name,
      displayName,
      kind: "warning",
    }),
  );
  await expect(page.locator("#pluginName")).toHaveValue(name);
  await page.locator("#pluginSourceCommit").fill("abc123");
  const publishButton = page.getByRole("button", { name: "Publish plugin" });
  await expect(publishButton).toBeEnabled({ timeout: 60_000 });
  await publishButton.click({ timeout: 15_000 });
  const claim = await claimMockPrePublicationChecks({
    kind: "package",
    slug: name,
    version,
  });

  const result = (await completeMockPrePublicationChecks({
    kind: "package",
    slug: name,
    version,
    clawscan: "malicious",
    claim,
  })) as { status?: string };
  expect(result.status).toBe("blocked");
  await expect(await publicPackageVersionExists(request, name, version)).toBe(false);
  await expectHealthyInspectorPage(page, errors);
});

test("plugin inspector blocks hard publish errors and publishes warning findings", async ({
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page, { includeConsoleLocation: true });
  const suffix = Date.now().toString(36);

  await signInAsLocalPersona(page, "admin");

  await publishHardErrorPluginWithRetry({
    errors,
    page,
    suffix,
    testInfo,
  });
  await captureProof(page, testInfo, "01-upload-hard-error");
  const { warningName } = await publishWarningPluginWithRetry({
    errors,
    page,
    suffix,
    testInfo,
  });
  await captureProof(page, testInfo, "02-upload-warning-success");

  await expectDashboardWarningReview(page, warningName);
  await captureProof(page, testInfo, "03-dashboard-warning-count");
  await page.goto(buildPluginValidationHref(warningName), { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(new RegExp(`/plugins/${escapeRegExp(warningName)}#validation$`));
  await expectValidationSectionVisible(page, warningName);
  await expect(
    page.locator(".plugin-warning-item-code").filter({
      hasText: /^legacy-before-agent-start$/,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Deprecated API/)).toBeVisible();
  await expect(page.getByText(/legacy-before-agent-start/)).toBeVisible();
  await expect(page.getByText(/before_agent_start hook compatibility/i)).toBeVisible();
  await captureProof(page, testInfo, "04-plugin-public-warnings");

  await expectHealthyInspectorPage(page, errors);
});
