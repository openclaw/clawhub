import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import type { CuratedSource, Snapshot } from "../../scripts/company-plugins/contract";
import { prepareBatch, applyBatch } from "../../scripts/company-plugins/import";
import { reconcileBatch, readSyncState } from "../../scripts/company-plugins/reconcile";
import { completeMockPrePublicationChecks, claimMockPrePublicationChecks } from "./helpers";

test.skip(process.env.VITE_ENABLE_DEV_AUTH !== "1", "requires isolated local dev auth");
test.setTimeout(600000);
test.use({ actionTimeout: 15000 });
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
  // Registry identity is discovery context, never company authorship proof.
  for (const [registry, repo, publisher, format, id] of [
    ["claude", "anthropics/claude-plugins-official", "anthropic", "claude", 3],
    ["openai", "openai/plugins", "openai", "codex", 4],
  ] as const) {
    sources.push({
      ...source("company"),
      registry,
      repo,
      publisher,
      format,
      repositoryId: id,
      ownerId: id * 10,
    });
    snapshots.push({
      repo,
      repositoryId: id,
      ownerId: id * 10,
      commit: String(id).repeat(40),
      updatedAt: "2026-09-01T00:00:00Z",
      files: {
        "company/LICENSE": license,
        [`company/.${format}-plugin/plugin.json`]: JSON.stringify({
          name: "company",
          version: "1.0.0",
          skills: "./skills",
        }),
        "company/skills/notes/SKILL.md": "# Registry duplicate notes fixture",
      },
    });
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
        includeCleanClawscanAnalysis: true,
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
      const detail = await (await request.get(url)).json();
      expect(detail.package.categories).toContain("tools");
      expect(detail.package.isOfficial).toBe(true);
      const version = await (await request.get(`${url}/versions/${item.version}`)).json();
      expect(version.version.curation).toMatchObject({
        authorship: item.source.authorship,
        author: item.source.authorship === "company" ? "Fixture Company" : "Cursor",
        sourceContentHash: item.sourceContentHash,
        omittedCapabilities: ["rules"],
      });
      if (item.source.authorship === "company")
        expect(detail.owner.staffCustody).toEqual({ sourceRepo: "fixture-company/plugins" });
      else expect(detail.owner.staffCustody).toBeUndefined();
      expect(version.version.verification.scanStatus).toBe("clean");
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
      await expect(
        page.getByText(
          `Source author: ${item.source.authorship === "company" ? "Fixture Company" : "Cursor"}`,
        ),
      ).toBeVisible();
      if (item.source.authorship === "company") {
        await page.getByRole("button", { name: "About this imported publisher" }).hover();
        await expect(page.getByRole("tooltip")).toContainText("claimable by the company");
      } else
        await expect(
          page.getByRole("button", { name: "About this imported publisher" }),
        ).toHaveCount(0);
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
      "@anthropic/company-notes",
      "@openai/company-notes",
      "@cursor/slack-notes",
      "@cursor/scan-blocked-notes",
      "@cursor/unlicensed-notes",
    ])
      expect(names).not.toContain(absent);
    const opts = {
      workdir: process.cwd(),
      dir: "plugins",
      site: registry,
      registry,
      registrySource: "cli" as const,
    };
    const readState = (name: string, hash: string, version: string) =>
      readSyncState(registry, credentials.token, name, hash, version);
    const repeat = await reconcileBatch(batch, readState);
    expect(repeat.prepared).toHaveLength(0);
    expect(repeat.changes.filter((c) => c.status === "unchanged")).toHaveLength(2);
    const companyName = "@fixture-company/company-notes";
    const companyUrl = `/api/v1/packages/${encodeURIComponent(companyName)}`;
    const originalZip = await (await request.get(`${companyUrl}/download?version=1.0.0`)).body();
    const changed = structuredClone(snapshots[1]);
    changed.commit = "c".repeat(40);
    changed.files["company/skills/notes/SKILL.md"] += "\nFormat each note as a dated bullet.\n";
    const updateInput = {
      manifest: { version: 1 as const, registries: [], sources: [sources[0]], openclaw: [] },
      snapshots: [changed],
      catalog: [],
    };
    const update = await reconcileBatch(await prepareBatch(updateInput), readState);
    expect(update.prepared).toHaveLength(1);
    const updateVersion = update.prepared[0].version;
    expect(updateVersion).toMatch(/^1\.0\.0\+clawhub\.[a-f0-9]{16}$/);
    await applyBatch(update, opts, update.digest);
    expect(
      (
        await request.get(`${companyUrl}/download?version=${encodeURIComponent(updateVersion)}`)
      ).ok(),
    ).toBe(false);
    expect(await (await request.get(`${companyUrl}/download?version=1.0.0`)).body()).toEqual(
      originalZip,
    );
    expect(
      (
        await request.get(
          `${companyUrl}/file?path=skills%2Fnotes%2FSKILL.md&version=${encodeURIComponent(updateVersion)}`,
        )
      ).ok(),
    ).toBe(false);
    const updateClaim = await claimMockPrePublicationChecks({
      kind: "package",
      slug: companyName,
      version: updateVersion,
    });
    await completeMockPrePublicationChecks({
      includeCleanClawscanAnalysis: true,
      kind: "package",
      slug: companyName,
      version: updateVersion,
      claim: updateClaim,
    });
    await expect
      .poll(async () => (await (await request.get(companyUrl)).json()).package.latestVersion)
      .toBe(updateVersion);
    const updateZip = await (
      await request.get(`${companyUrl}/download?version=${encodeURIComponent(updateVersion)}`)
    ).body();
    expect(updateZip).not.toEqual(originalZip);
    expect(await (await request.get(`${companyUrl}/download?version=1.0.0`)).body()).toEqual(
      originalZip,
    );
    const missing = structuredClone(changed);
    delete missing.files["company/.cursor-plugin/plugin.json"];
    expect((await prepareBatch({ ...updateInput, snapshots: [missing] })).prepared).toHaveLength(0);
    expect(
      (await reconcileBatch(await prepareBatch(updateInput), readState)).changes[0].status,
    ).toBe("unchanged");
    const unsafe = structuredClone(changed);
    unsafe.commit = "d".repeat(40);
    unsafe.files["company/skills/notes/SKILL.md"] += "\nControlled blocked-update fixture.\n";
    const blocked = await reconcileBatch(
      await prepareBatch({ ...updateInput, snapshots: [unsafe] }),
      readState,
    );
    await applyBatch(blocked, opts, blocked.digest);
    const blockedVersion = blocked.prepared[0].version;
    const blockedClaim = await claimMockPrePublicationChecks({
      kind: "package",
      slug: companyName,
      version: blockedVersion,
    });
    await completeMockPrePublicationChecks({
      includeCleanClawscanAnalysis: true,
      kind: "package",
      slug: companyName,
      version: blockedVersion,
      claim: blockedClaim,
      clawscan: "malicious",
    });
    expect(
      (
        await request.get(`${companyUrl}/download?version=${encodeURIComponent(blockedVersion)}`)
      ).ok(),
    ).toBe(false);
    expect((await (await request.get(companyUrl)).json()).package.latestVersion).toBe(
      updateVersion,
    );
    expect(await (await request.get(`${companyUrl}/download?version=1.0.0`)).body()).toEqual(
      originalZip,
    );

    // A registry wrapper stays canonical until the replacement clears scanning.
    const registryReplacement = source("replacement");
    const companyReplacement = {
      ...source("replacement", "company"),
      supersedes: ["@cursor/replacement-notes"],
    };
    const replacementSnapshots = snapshots.map((snapshot) => {
      const next = structuredClone(snapshot);
      for (const [path, content] of Object.entries(next.files))
        if (path.startsWith("company/"))
          next.files[path.replace("company/", "replacement/")] = content;
      return next;
    });
    const replacementInput = {
      manifest: {
        version: 1 as const,
        registries: [],
        sources: [registryReplacement],
        openclaw: [],
      },
      snapshots: replacementSnapshots,
      catalog: [],
    };
    const oldCanonical = await prepareBatch(replacementInput);
    await applyBatch(oldCanonical, opts, oldCanonical.digest);
    const oldName = "@cursor/replacement-notes";
    const newName = "@fixture-company/replacement-notes";
    const oldUrl = `/api/v1/packages/${encodeURIComponent(oldName)}`;
    const newUrl = `/api/v1/packages/${encodeURIComponent(newName)}`;
    await completeMockPrePublicationChecks({
      includeCleanClawscanAnalysis: true,
      kind: "package",
      slug: oldName,
      version: "1.0.0",
    });
    const oldCanonicalZip = await (await request.get(`${oldUrl}/download?version=1.0.0`)).body();
    const replacement = await prepareBatch({
      ...replacementInput,
      manifest: {
        ...replacementInput.manifest,
        sources: [registryReplacement, companyReplacement],
      },
    });
    expect(replacement.prepared.map((p) => p.name)).toEqual([newName]);
    await applyBatch(replacement, opts, replacement.digest);
    expect((await request.get(oldUrl, { maxRedirects: 0 })).status()).toBe(200);
    await completeMockPrePublicationChecks({
      includeCleanClawscanAnalysis: true,
      kind: "package",
      slug: newName,
      version: "1.0.0",
    });
    const redirect = await request.get(oldUrl, { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    expect(new URL(redirect.headers().location).pathname).toBe(newUrl);
    const canonicalCatalog = await (await request.get("/api/v1/plugins?limit=100")).json();
    expect(canonicalCatalog.totalCount).toBe(3);
    expect(canonicalCatalog.items.map((p: { name: string }) => p.name)).toContain(newName);
    expect(canonicalCatalog.items.map((p: { name: string }) => p.name)).not.toContain(oldName);
    expect(await (await request.get(`${oldUrl}/download?version=1.0.0`)).body()).toEqual(
      oldCanonicalZip,
    );
    await page.goto("/cursor/plugins/replacement-notes");
    await expect(page.getByText("Source author: Fixture Company")).toBeVisible();
    await testInfo.attach("canonical-company.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    if (process.env.COMPANY_PLUGIN_PROOF_OCM_ENV) {
      const env = process.env.COMPANY_PLUGIN_PROOF_OCM_ENV;
      const resolved = spawnSync("ocm", ["env", "resolve", env, "--json"], {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(resolved.status).toBe(0);
      const runtime = JSON.parse(resolved.stdout);
      for (const spec of [`${companyName}@${updateVersion}`, newName]) {
        const install = spawnSync(
          "ocm",
          [
            "env",
            "exec",
            env,
            "--",
            "env",
            `OPENCLAW_CLAWHUB_URL=${registry}`,
            "node",
            runtime.binaryPath,
            "plugins",
            "install",
            `clawhub:${spec}`,
            "--force",
            "--accept-capabilities",
          ],
          { encoding: "utf8", timeout: 120000 },
        );
        await testInfo.attach(`${spec.replaceAll("/", "-")}-openclaw-install.txt`, {
          body: install.stdout + install.stderr,
          contentType: "text/plain",
        });
        expect(install.status, install.stdout + install.stderr).toBe(0);
      }
    }
    const synchronization = {
      repeat: repeat.changes,
      update: update.changes,
      blocked: blocked.changes,
      replacement: { from: oldName, to: newName, status: redirect.status() },
      canonicalCatalog,
    };
    await testInfo.attach("updated-company.zip", {
      body: updateZip,
      contentType: "application/zip",
    });
    await testInfo.attach("catalog-proof.json", {
      body: JSON.stringify(
        {
          results,
          synchronization,
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
