import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import type { CuratedSource, Snapshot } from "../../scripts/company-plugins/contract";
import { prepareBatch, applyBatch } from "../../scripts/company-plugins/import";
import { completeMockPrePublicationChecks, claimMockPrePublicationChecks } from "./helpers";

test.skip(process.env.VITE_ENABLE_DEV_AUTH !== "1", "requires isolated local dev auth");
test.setTimeout(600000);
test("curated company and registry bundles cross the real catalog and download boundaries", async ({
  request,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "One synchronization run per disposable backend");
  const license = await readFile("LICENSE", "utf8");
  const source = (
    integration: string,
    authorship: "registry" | "company" = "registry",
  ): CuratedSource => ({
    integration,
    job: "notes",
    repo: authorship === "company" ? "fixture-company/plugins" : "cursor/plugins",
    path: integration,
    ref: "main",
    publisher: authorship === "company" ? "fixture-company" : "cursor",
    authorship,
    registry: "cursor",
    format: "cursor",
    repositoryId: authorship === "company" ? 2 : 1,
    ownerId: authorship === "company" ? 20 : 10,
    ownershipEvidence: "https://example.com/fixture-company",
    categories: ["tools"],
  });
  const sources = [
    source("company", "company"),
    source("company"),
    source("registry"),
    source("scan-blocked"),
    source("unlicensed"),
    source("slack"),
  ];
  const snapshots: Snapshot[] = [
    {
      repo: "cursor/plugins",
      repositoryId: 1,
      ownerId: 10,
      commit: "a".repeat(40),
      updatedAt: "2026-09-01T00:00:00Z",
      files: {},
    },
    {
      repo: "fixture-company/plugins",
      repositoryId: 2,
      ownerId: 20,
      commit: "b".repeat(40),
      updatedAt: "2026-09-01T00:00:00Z",
      files: {},
    },
  ];
  for (const s of sources) {
    const snapshot = snapshots.find((p) => p.repo === s.repo)!;
    snapshot.files[`${s.path}/.cursor-plugin/plugin.json`] = JSON.stringify({
      name: s.integration,
      version: "1.0.0",
      description: "Local catalog integration acceptance fixture",
      author: { name: s.authorship === "company" ? "Fixture Company" : "Cursor" },
      skills: "./skills",
      rules: "./rules",
    });
    snapshot.files[`${s.path}/skills/notes/SKILL.md`] =
      "# Local notes fixture\n\nReturn the user's supplied notes in chronological order. Do not read files, execute commands or contact external services.\n";
    snapshot.files[`${s.path}/rules/ignored.mdc`] = "Unsupported Cursor rule";
    if (s.integration !== "unlicensed") snapshot.files[`${s.path}/LICENSE`] = license;
  }
  const batch = await prepareBatch({
    manifest: {
      version: 1,
      registries: [],
      sources,
      openclaw: [
        {
          integration: "slack",
          job: "notes",
          bundledId: "slack",
          evidence: "https://github.com/openclaw/openclaw/tree/main/extensions/slack",
        },
      ],
    },
    snapshots,
    catalog: [],
  });
  expect(batch.plan.packages.map((p) => p.name).sort()).toEqual([
    "@cursor/registry-notes",
    "@cursor/scan-blocked-notes",
    "@fixture-company/company-notes",
  ]);
  expect(batch.inventory.candidates.find((c) => c.integration === "unlicensed")?.status).toBe(
    "blocked",
  );
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
      "devSeed:seedCompanyPluginImportFixtures",
      "{}",
    ],
    { encoding: "utf8", timeout: 120000, env: process.env },
  );
  if (seed.status !== 0) throw new Error(`Fixture seed failed: ${seed.stderr}`);
  const start = seed.stdout.indexOf("{");
  const credentials = JSON.parse(seed.stdout.slice(start));
  const root = await mkdtemp(join(tmpdir(), "company-plugin-proof-"));
  const previous = process.env.CLAWHUB_CONFIG_PATH;
  const registry = process.env.PLAYWRIGHT_BASE_URL!;
  try {
    const config = join(root, "config.json");
    await writeFile(config, JSON.stringify({ registry, token: credentials.token }), {
      mode: 0o600,
    });
    process.env.CLAWHUB_CONFIG_PATH = config;
    const results = await applyBatch(
      batch,
      { workdir: process.cwd(), dir: "plugins", site: registry, registry, registrySource: "cli" },
      batch.digest,
    );
    for (const item of batch.prepared) {
      const url = `/api/v1/packages/${encodeURIComponent(item.name)}`;
      expect((await request.get(`${url}/download?version=${item.version}`)).ok()).toBe(false);
      const before = await (await request.get("/api/v1/plugins?limit=100")).json();
      expect(before.items.map((p: { name: string }) => p.name)).not.toContain(item.name);
      const claim = await claimMockPrePublicationChecks({
        kind: "package",
        slug: item.name,
        version: item.version,
      });
      expect(claim.files?.map((f) => f.path)).toContain("CLAWHUB_SOURCE.json");
      expect(claim.files?.map((f) => f.path)).not.toContain("rules/ignored.mdc");
      await completeMockPrePublicationChecks({
        kind: "package",
        slug: item.name,
        version: item.version,
        claim,
        clawscan: item.name.includes("scan-blocked") ? "malicious" : "clean",
      });
      if (item.name.includes("scan-blocked")) {
        expect((await request.get(`${url}/download?version=${item.version}`)).ok()).toBe(false);
        continue;
      }
      await expect.poll(async () => (await request.get(url)).status()).toBe(200);
      const download = await request.get(`${url}/download?version=${item.version}`);
      expect(download.ok()).toBe(true);
      const bytes = await download.body();
      const files = Object.fromEntries(
        Object.entries(unzipSync(bytes)).map(([path, content]) => [
          path.replace(/^package\//, ""),
          content,
        ]),
      );
      expect(Buffer.from(files.LICENSE).toString()).toBe(license);
      const provenance = JSON.parse(Buffer.from(files["CLAWHUB_SOURCE.json"]).toString());
      expect(provenance).toMatchObject({
        commit: item.provenance.commit,
        authorship: item.source.authorship,
        sourceContentHash: item.sourceContentHash,
        omittedCapabilities: ["rules"],
      });
      if (process.env.COMPANY_PLUGIN_PROOF_OCM_ENV) {
        const resolved = spawnSync(
          "ocm",
          ["env", "resolve", process.env.COMPANY_PLUGIN_PROOF_OCM_ENV, "--json"],
          { encoding: "utf8", timeout: 10000 },
        );
        expect(resolved.status, resolved.stderr).toBe(0);
        const runtime = JSON.parse(resolved.stdout);
        expect(runtime.bindingKind).toBe("runtime");
        expect(typeof runtime.binaryPath).toBe("string");
        const install = spawnSync(
          "ocm",
          [
            "env",
            "exec",
            process.env.COMPANY_PLUGIN_PROOF_OCM_ENV,
            "--",
            "env",
            `OPENCLAW_CLAWHUB_URL=${registry}`,
            "node",
            runtime.binaryPath,
            "plugins",
            "install",
            `clawhub:${item.name}@${item.version}`,
            "--force",
            "--accept-capabilities",
          ],
          {
            encoding: "utf8",
            timeout: 120000,
            env: process.env,
          },
        );
        await testInfo.attach(`${item.source.publisher}-openclaw-install.txt`, {
          body: install.stdout + install.stderr,
          contentType: "text/plain",
        });
        expect(install.status, install.stdout + install.stderr).toBe(0);
      }
      await testInfo.attach(`${item.source.publisher}-${item.source.integration}.zip`, {
        body: bytes,
        contentType: "application/zip",
      });
      await page.goto(`/${item.source.publisher}/plugins/${item.source.integration}-notes`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(item.source.integration);
      await testInfo.attach(`${item.source.publisher}-${item.source.integration}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
    const catalog = await (await request.get("/api/v1/plugins?limit=100")).json();
    const names = catalog.items.map((p: { name: string }) => p.name);
    expect(names).toContain("@cursor/registry-notes");
    expect(names).toContain("@fixture-company/company-notes");
    for (const absent of [
      "@cursor/company-notes",
      "@cursor/slack-notes",
      "@cursor/scan-blocked-notes",
      "@cursor/unlicensed-notes",
    ])
      expect(names).not.toContain(absent);
    await testInfo.attach("catalog-proof.json", {
      body: JSON.stringify(
        {
          results,
          catalog,
          inventory: batch.inventory,
          scanner:
            "Controlled mock results through the real prepublication worker protocol; not a live ClawScan certification",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    if (previous === undefined) delete process.env.CLAWHUB_CONFIG_PATH;
    else process.env.CLAWHUB_CONFIG_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});
