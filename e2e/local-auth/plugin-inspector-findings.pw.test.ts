import { writeFile } from "node:fs/promises";
import { expect, type Page, test, type TestInfo } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import {
  expectNoFatalErrorUi,
  expectNoRuntimeErrors,
  trackRuntimeErrors,
  waitForHydration,
} from "../helpers/runtimeErrors";
import { buildPluginValidationHref, escapeRegExp, signInAsLocalPersona } from "./helpers";

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
  await page.locator('input[type="file"]').first().setInputFiles(zipPath);
  await waitForHydration(page);
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

async function expectHealthyInspectorPage(page: Page, errors: string[]) {
  const expectedTransientTimeouts = [
    "CONVEX Q(packages:canDeleteVersions)",
    "CONVEX Q(packages:getManageContext)",
    "CONVEX Q(packages:getPackageInspectorValidationSummaryPublic)",
    "CONVEX Q(packages:list)",
    "CONVEX Q(publishers:getMyProfileHandle)",
    "CONVEX Q(publishers:listMine)",
  ];
  await expectNoFatalErrorUi(page);
  await expectNoRuntimeErrors(
    page,
    errors.filter(
      (error) =>
        !(
          error.includes("Function execution timed out (maximum duration: 1s)") &&
          expectedTransientTimeouts.some((functionName) => error.includes(functionName))
        ),
    ),
  );
}

async function expectDashboardWarningLink(page: Page, warningName: string) {
  const dashboardWarningLink = page.locator(`a[href="${buildPluginValidationHref(warningName)}"]`);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    try {
      await expect(dashboardWarningLink).toBeVisible({ timeout: 30_000 });
      return dashboardWarningLink;
    } catch (error) {
      if (attempt >= 3) throw error;
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  return dashboardWarningLink;
}

async function expectValidationSectionVisible(page: Page, warningName: string) {
  const detailHref = buildPluginValidationHref(warningName);
  const validationSection = page.locator("#validation");

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await waitForHydration(page).catch(() => {});
    if ((await validationSection.count()) > 0) {
      await expect(validationSection).toBeVisible({ timeout: 10_000 });
      return;
    }
    await page.goto(detailHref, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500 * attempt);
  }

  await expect(validationSection).toBeVisible({ timeout: 10_000 });
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
      await expect(args.page.getByText("Published. Pending security checks")).toBeVisible({
        timeout: 60_000,
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

test("plugin inspector blocks hard publish errors and publishes warning findings", async ({
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
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

  const dashboardWarningLink = await expectDashboardWarningLink(page, warningName);
  await captureProof(page, testInfo, "03-dashboard-warning-count");
  await dashboardWarningLink.click();

  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(buildPluginValidationHref(warningName))}$`),
  );
  await expectValidationSectionVisible(page, warningName);
  await expect(
    page.locator(".plugin-warning-item-code").filter({
      hasText: /^legacy-before-agent-start$/,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Warning · Deprecated API · P2/)).toBeVisible();
  await expect(page.getByText(/before_agent_start hook compatibility/i)).toBeVisible();
  await captureProof(page, testInfo, "04-plugin-public-warnings");

  await expectHealthyInspectorPage(page, errors);
});
