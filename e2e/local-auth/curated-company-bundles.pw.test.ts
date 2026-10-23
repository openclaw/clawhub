import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { claimMockPrePublicationChecks, completeMockPrePublicationChecks } from "./helpers";

test.skip(process.env.VITE_ENABLE_DEV_AUTH !== "1", "requires disposable local Convex");
test.setTimeout(600_000);

test("curated company bundles retain exact bytes through publication and download", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one publication per isolated backend");
  const registry = process.env.PLAYWRIGHT_BASE_URL!;
  expect(new URL(registry).hostname).toBe("127.0.0.1");
  const seed = spawnSync(
    "bunx",
    [
      "convex",
      "run",
      "--no-push",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "devSeed:seedCliRoleHelpFixtures",
      "{}",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  expect(seed.status, seed.stderr).toBe(0);
  const fixture = JSON.parse(seed.stdout.slice(seed.stdout.indexOf("{")));
  const temp = await mkdtemp(join(tmpdir(), "curated-bundles-"));
  const config = join(temp, "config.json");
  // This is an ephemeral local fixture token, never a provider or production credential.
  await writeFile(config, JSON.stringify({ registry, token: fixture.admin.token }), {
    mode: 0o600,
  });
  const receipts: unknown[] = [];
  try {
    await page.goto("/plugins?new=true");
    await expect(page.getByLabel("Plugin categories")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("catalog-before.png"), fullPage: true });
    for (const slug of ["godaddy", "excalidraw"]) {
      const name = `${slug}-mcp`;
      const folder = join(process.cwd(), "integrations/company", slug);
      const manifest = JSON.parse(await readFile(join(folder, "openclaw.plugin.json"), "utf8"));
      const publish = spawnSync(
        "bun",
        [
          "packages/clawhub/src/cli.ts",
          "--registry",
          registry,
          "package",
          "publish",
          folder,
          "--family",
          "bundle-plugin",
          "--name",
          name,
          "--version",
          "1.0.0",
          "--changelog",
          "Manually curated official service connection.",
        ],
        {
          encoding: "utf8",
          timeout: 120_000,
          env: { ...process.env, CLAWHUB_CONFIG_PATH: config },
        },
      );
      expect(publish.status, publish.stderr).toBe(0);
      const route = `/api/v1/packages/${name}`;
      expect((await request.get(`${route}/download?version=1.0.0`)).ok()).toBe(false);
      const pending = await (await request.get("/api/v1/plugins?limit=100")).json();
      expect(pending.items.map((item: { name: string }) => item.name)).not.toContain(name);
      const claim = await claimMockPrePublicationChecks({
        kind: "package",
        slug: name,
        version: "1.0.0",
      });
      // Simulated ClawScan/TruffleHog verdicts exercise real publication gates, not provider certification.
      await completeMockPrePublicationChecks({
        includeCleanClawscanAnalysis: true,
        kind: "package",
        slug: name,
        version: "1.0.0",
        claim,
        clawscan: "clean",
      });
      await expect.poll(async () => (await request.get(route)).status()).toBe(200);
      const detail = await (await request.get(route)).json();
      expect(detail.package.categories).toEqual(manifest.categories);
      const archive = await request.get(`${route}/download?version=1.0.0`);
      expect(archive.ok()).toBe(true);
      const bytes = await archive.body();
      const entries = Object.fromEntries(
        Object.entries(unzipSync(bytes)).map(([path, content]) => [
          path.replace(/^package\//, ""),
          content,
        ]),
      );
      const paths = (await readdir(folder, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1));
      expect(Object.keys(entries).sort()).toEqual(paths.sort());
      for (const path of paths)
        expect(Buffer.from(entries[path])).toEqual(await readFile(join(folder, path)));
      const owner = detail.owner?.handle ?? detail.package.ownerHandle ?? "cli-admin";
      await page.goto(`/${owner}/plugins/${name}`);
      await expect(page.locator(".skill-page-title")).toHaveText(manifest.name);
      await page.screenshot({ path: testInfo.outputPath(`${slug}-detail.png`), fullPage: true });
      const receipt = {
        name,
        version: "1.0.0",
        files: paths.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        simulatedSecurity: ["ClawScan", "TruffleHog"],
      };
      receipts.push(receipt);
      if (process.env.CURATED_COMPANY_PROOF_OCM_ENV) {
        const installed = spawnSync(
          "ocm",
          [
            `@${process.env.CURATED_COMPANY_PROOF_OCM_ENV}`,
            "--",
            "plugins",
            "install",
            `clawhub:${name}@1.0.0`,
            "--force",
            "--accept-capabilities",
          ],
          {
            encoding: "utf8",
            timeout: 120_000,
            env: { ...process.env, CLAWHUB_URL: registry },
          },
        );
        expect(installed.status, installed.stderr).toBe(0);
        await writeFile(testInfo.outputPath(`${slug}-install.txt`), installed.stdout);
      }
    }
    await page.goto("/plugins?new=true");
    await expect(
      page.getByRole("link", { name: "Plugin: GoDaddy Domains", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Plugin: Excalidraw", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("catalog-after.png"), fullPage: true });
    await writeFile(
      testInfo.outputPath("download-receipts.json"),
      JSON.stringify(receipts, null, 2),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
