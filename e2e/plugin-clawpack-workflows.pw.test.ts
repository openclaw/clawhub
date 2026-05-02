import { expect, test } from "@playwright/test";
import { zipSync } from "fflate";
import { expectHealthyPage, trackRuntimeErrors } from "./helpers/runtimeErrors";

const encoder = new TextEncoder();

function makePluginZip() {
  return Buffer.from(
    zipSync({
      "demo-plugin/package.json": encoder.encode(
        JSON.stringify({
          name: "demo-plugin",
          displayName: "Demo Plugin",
          version: "1.2.3",
          repository: "https://github.com/openclaw/demo-plugin.git",
          openclaw: {
            extensions: ["./dist/index.js"],
            compat: {
              pluginApi: ">=2026.3.24-beta.2",
            },
            build: {
              openclawVersion: "2026.3.24-beta.2",
              pluginSdkVersion: "2026.3.24-beta.2",
            },
          },
        }),
      ),
      "demo-plugin/openclaw.plugin.json": encoder.encode(
        JSON.stringify({
          id: "demo.plugin",
          name: "Demo Plugin",
          setupEntry: "./dist/setup.js",
        }),
      ),
      "demo-plugin/dist/index.js": encoder.encode("export const demo = true;\n"),
      "demo-plugin/CLAWPACK.json": encoder.encode('{"forged": true}\n'),
    }),
  );
}

test("publisher can upload an archive and inspect the ClawPack preview", async ({ page }) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/publish-plugin", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Publish Plugin" })).toBeVisible();
  await expect(page.locator('[data-upload-ready="true"]')).toBeVisible();

  await page.locator('input[aria-label="Package archive input"]').setInputFiles({
    name: "demo-plugin.zip",
    mimeType: "application/zip",
    buffer: makePluginZip(),
  });

  await expect(page.getByText("Package detected")).toBeVisible();
  await expect(page.getByPlaceholder("Plugin name")).toHaveValue("demo-plugin");
  await expect(page.getByPlaceholder("Display name")).toHaveValue("Demo Plugin");
  await expect(page.getByPlaceholder("Version")).toHaveValue("1.2.3");
  await expect(page.getByPlaceholder("Source repo (owner/repo)")).toHaveValue(
    "openclaw/demo-plugin",
  );
  await expect(page.getByRole("heading", { name: "ClawPack preview" })).toBeVisible();
  await expect(page.getByText('"kind": "openclaw.clawpack"')).toBeVisible();
  await expect(
    page.getByText("CLAWPACK.json supplied by package will be replaced by ClawHub."),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Publish" })).toBeDisabled();
  await expectHealthyPage(page, errors);
});

test("management child routes stay on the management URL and show access diagnostics", async ({
  page,
}) => {
  const errors = trackRuntimeErrors(page);

  await page.goto("/management/clawpacks", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/management\/clawpacks$/);
  await expect(page.getByText("Management access required")).toBeVisible();

  await page.goto("/management/moderation", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/management\/moderation$/);
  await expect(page.getByText("Management access required")).toBeVisible();

  await page.goto("/management/migrations", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/management\/migrations$/);
  await expect(page.getByText("Management access required")).toBeVisible();
  await expectHealthyPage(page, errors);
});
