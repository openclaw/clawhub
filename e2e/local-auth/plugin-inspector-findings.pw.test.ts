import { writeFile } from "node:fs/promises";
import { expect, type Page, test, type TestInfo } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { expectHealthyPage, trackRuntimeErrors, waitForHydration } from "../helpers/runtimeErrors";
import { buildPluginValidationHref, escapeRegExp, signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "local-auth plugin inspector tests require the local dev auth runner",
);

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

test("plugin inspector blocks hard publish errors and publishes warning findings", async ({
  page,
}, testInfo) => {
  const errors = trackRuntimeErrors(page);
  const suffix = Date.now().toString(36);
  const badName = `pw-inspector-bad-${suffix}`;
  const warningName = `pw-inspector-warning-${suffix}`;
  const warningDisplayName = `Playwright Inspector Warning Plugin ${suffix}`;

  await signInAsLocalPersona(page, "admin");

  await page.goto("/plugins/publish", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Publish Plugin" })).toBeVisible();
  await uploadPluginZip(
    page,
    await writePluginZip(testInfo, {
      name: badName,
      displayName: "Playwright Inspector Bad Plugin",
      kind: "hard-error",
    }),
  );
  await expect(page.locator("#pluginName")).toHaveValue(badName);
  await page.locator("#pluginSourceCommit").fill("abc123");
  await page.getByRole("button", { name: "Publish plugin" }).click();
  await expect(page.getByRole("alert")).toContainText("Plugin Inspector blocked publish", {
    timeout: 60_000,
  });
  await captureProof(page, testInfo, "01-upload-hard-error");
  errors.length = 0;

  await page.goto("/plugins/publish", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await uploadPluginZip(
    page,
    await writePluginZip(testInfo, {
      name: warningName,
      displayName: warningDisplayName,
      kind: "warning",
    }),
  );
  await expect(page.locator("#pluginName")).toHaveValue(warningName);
  await page.locator("#pluginSourceCommit").fill("abc123");
  await page.getByRole("button", { name: "Publish plugin" }).click();
  await expect(page.getByText("Published. Pending security checks")).toBeVisible({
    timeout: 60_000,
  });
  await captureProof(page, testInfo, "02-upload-warning-success");

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  const dashboardWarningLink = page.locator(`a[href="${buildPluginValidationHref(warningName)}"]`);
  await expect(dashboardWarningLink).toBeVisible({ timeout: 30_000 });
  await captureProof(page, testInfo, "03-dashboard-warning-count");
  await dashboardWarningLink.click();

  await expect(page).toHaveURL(new RegExp(`/plugins/${escapeRegExp(warningName)}#validation$`));
  await expect(page.getByRole("tab", { name: /Validation \(\d+\)/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.locator(".plugin-warning-item-header code").filter({
      hasText: /^legacy-before-agent-start$/,
    }),
  ).toBeVisible();
  await expect(page.getByText("deprecation-warning")).toBeVisible();
  await expect(page.getByText(/before_agent_start hook compatibility/i)).toBeVisible();
  await captureProof(page, testInfo, "04-plugin-public-warnings");

  await expectHealthyPage(page, errors);
});
