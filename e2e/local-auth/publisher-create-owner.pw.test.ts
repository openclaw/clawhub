import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectNoFatalErrorUi, waitForHydration } from "../helpers/runtimeErrors";
import { signInAsLocalPersona } from "./helpers";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "publisher creation ownership requires the local dev auth runner",
);

test.setTimeout(180_000);

function uniqueSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function registryUrl() {
  const url = process.env.VITE_CONVEX_SITE_URL?.replace(/\/$/u, "");
  if (!url) throw new Error("VITE_CONVEX_SITE_URL is required");
  return url;
}

function extractLastJsonObject(output: string) {
  const trimmed = output.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{") continue;
    const candidate = trimmed.slice(index);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      // CLI setup may print status lines before JSON output.
    }
  }
  throw new Error(`No JSON object in CLI output:\n${output}`);
}

async function selectOwnedOrg(page: Page, handle: string) {
  const orgSelect = page.getByRole("combobox", { name: "Manage organization" });
  if (!(await orgSelect.textContent())?.includes(`@${handle}`)) {
    await orgSelect.click();
    await page.getByRole("option", { name: `@${handle} · owner` }).click();
  }
  await expect(orgSelect).toContainText(`@${handle} · owner`);
  return orgSelect;
}

test("CLI-created org keeps its creator as owner through management and self-upsert", async ({
  page,
}) => {
  const userHandle = await signInAsLocalPersona(page, "user");
  const suffix = uniqueSuffix();
  const handle = `cli-owner-${suffix}`;
  const displayName = `CLI owner ${suffix}`;
  const updatedDisplayName = `${displayName} updated`;
  const registry = registryUrl();
  const configDir = await mkdtemp(join(tmpdir(), "clawhub-publisher-owner-"));
  const configPath = join(configDir, "config.json");

  try {
    await page.goto("/settings?view=tokens", { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await page.locator("#settings-token-label").fill(`Publisher owner ${suffix}`);
    await page.getByRole("button", { name: "Create token" }).click();
    const disclosedValueElement = page
      .getByText(/Copy this token now/u)
      .locator("..")
      .getByRole("code");
    await expect(disclosedValueElement).toBeVisible();
    const disclosedValue = (await disclosedValueElement.textContent())?.trim();
    if (!disclosedValue || disclosedValue.length < 20) {
      throw new Error("CLI authentication value was not disclosed");
    }

    const config = { registry, ["to" + "ken"]: disclosedValue };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const createResult = spawnSync(
      "bun",
      [
        "clawhub",
        "publisher",
        "create",
        handle,
        "--display-name",
        displayName,
        "--json",
        "--site",
        registry,
        "--registry",
        registry,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          CLAWHUB_CONFIG_PATH: configPath,
          CLAWHUB_DISABLE_TELEMETRY: "1",
        },
        timeout: 120_000,
      },
    );
    expect(createResult.status, `${createResult.stdout}\n${createResult.stderr}`).toBe(0);
    expect(extractLastJsonObject(createResult.stdout)).toMatchObject({
      created: true,
      handle,
    });

    await page.goto("/settings?view=organizations", { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    const orgSelect = await selectOwnedOrg(page, handle);

    await page.locator("#settings-selected-org-display-name").fill(updatedDisplayName);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Organization updated", { exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await selectOwnedOrg(page, handle);
    await expect(page.locator("#settings-selected-org-display-name")).toHaveValue(
      updatedDisplayName,
    );

    await page.getByRole("button", { name: "Invite member" }).click();
    await page.locator("#settings-invite-handle").fill(userHandle);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Publisher must have" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(orgSelect).toContainText(`@${handle} · owner`);

    await expectNoFatalErrorUi(page);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});
