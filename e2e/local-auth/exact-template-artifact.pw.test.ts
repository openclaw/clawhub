import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { localConvexDeployment } from "../helpers/localConvex";
import { completeMockPrePublicationChecks } from "./helpers";

test.setTimeout(180_000);

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "exact Template artifact proof requires the local dev auth runner",
);

function extractLastJsonObject(output: string) {
  const trimmed = output.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{") continue;
    const candidate = trimmed.slice(index);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      // Convex and the CLI may print status lines before their JSON payload.
    }
  }
  throw new Error(`No JSON object in output:\n${output}`);
}

function runDevSeed<T>(functionName: string, args: Record<string, unknown>) {
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
      env: { ...process.env, CONVEX_DEPLOYMENT: localConvexDeployment() },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      [`Failed to run ${functionName}.`, result.stdout.trim(), result.stderr.trim()].join("\n"),
    );
  }
  return extractLastJsonObject(result.stdout) as T;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("bun", ["packages/clawhub/src/cli.ts", ...args], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`ClawHub CLI exited ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

test("publishes, polls, retries, and downloads the exact Template tarball", async ({
  request,
  page,
}) => {
  const root = mkdtempSync(path.join(tmpdir(), "clawhub-exact-claw-proof-"));
  const sourceDir = path.join(root, "source");
  const configPath = path.join(root, "config.json");
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const packageName = `exact-claw-proof-${suffix}`;
  const version = "1.0.0";
  const registry = process.env.VITE_CONVEX_SITE_URL;
  if (!registry) throw new Error("VITE_CONVEX_SITE_URL is required");

  try {
    mkdirSync(path.join(sourceDir, "manifests"), { recursive: true });
    writeFileSync(
      path.join(sourceDir, "package.json"),
      JSON.stringify({
        name: packageName,
        version,
        openclaw: { template: "manifests/CLAW.md" },
      }),
    );
    writeFileSync(
      path.join(sourceDir, "manifests", "CLAW.md"),
      `---\n${JSON.stringify({
        schemaVersion: 1,
        agent: {
          id: packageName,
          name: "Exact Template Proof",
          tools: { profile: "minimal", allow: ["session_status"] },
          humanDelay: { mode: "natural" },
        },
        skills: [{ ref: "@acme/research", version: "1.2.3" }, { path: "skills/research" }],
        plugins: [{ ref: "@acme/alerts", version: "2.0.0" }, { path: "plugins/alerts" }],
        automations: [
          {
            id: "daily-brief",
            name: "Daily brief",
            enabled: false,
            schedule: { cron: "0 9 * * *", timezone: "UTC" },
            session: "isolated",
            message: "Summarize approved sources.",
          },
        ],
      })}\n---\nPreserve the exact published artifact.\n`,
    );

    mkdirSync(path.join(sourceDir, "skills/research/assets"), { recursive: true });
    writeFileSync(
      path.join(sourceDir, "skills/research/SKILL.md"),
      "---\nname: Bundled Research\ndescription: Research approved sources.\n---\nUse assets/reference.bin.\n",
    );
    writeFileSync(
      path.join(sourceDir, "skills/research/assets/reference.bin"),
      Buffer.from([0, 255, 128, 10]),
    );
    mkdirSync(path.join(sourceDir, "plugins/alerts/.codex-plugin"), { recursive: true });
    writeFileSync(
      path.join(sourceDir, "plugins/alerts/.codex-plugin/plugin.json"),
      JSON.stringify({ name: "Bundled Release Alerts", version: "9.0.0" }),
    );
    writeFileSync(
      path.join(sourceDir, "plugins/alerts/README.md"),
      "Bundled plugin support files.\n",
    );

    const pack = spawnSync("npm", ["pack", "--json", "--pack-destination", root], {
      cwd: sourceDir,
      encoding: "utf8",
    });
    if (pack.status !== 0) {
      throw new Error(`npm pack failed.\n${pack.stdout}\n${pack.stderr}`);
    }
    const packResult = JSON.parse(pack.stdout) as Array<{ filename: string }>;
    const artifactPath = path.join(root, packResult[0]?.filename ?? "");
    const artifactBytes = readFileSync(artifactPath);
    const artifactSha256 = sha256(artifactBytes);

    const fixtures = runDevSeed<{
      user: { token: string };
    }>("devSeed:seedCliRoleHelpFixtures", {});
    const cliEnv = {
      ...process.env,
      CLAWHUB_CONFIG_PATH: configPath,
      CLAWHUB_REGISTRY: registry,
      CLAWHUB_SITE: process.env.PLAYWRIGHT_BASE_URL ?? registry,
    };
    const login = spawnSync(
      "bun",
      [
        "packages/clawhub/src/cli.ts",
        "--registry",
        registry,
        "login",
        "--token",
        fixtures.user.token,
      ],
      { cwd: process.cwd(), env: cliEnv, encoding: "utf8" },
    );
    if (login.status !== 0) {
      throw new Error(`CLI login failed.\n${login.stdout}\n${login.stderr}`);
    }

    const publishArgs = [
      "--registry",
      registry,
      "--no-input",
      "package",
      "publish",
      artifactPath,
      "--family",
      "template",
      "--wait",
      "--wait-timeout",
      "120",
      "--json",
    ];
    const publication = runCli(publishArgs, cliEnv);
    const claim = await completeMockPrePublicationChecks({
      kind: "package",
      slug: packageName,
      version,
    });
    expect(claim.claim.artifactFingerprint).toBe(artifactSha256);
    const published = extractLastJsonObject((await publication).stdout);
    expect(published).toMatchObject({
      publicationStatus: "published",
      artifactSha256,
    });

    const packagePath = encodeURIComponent(packageName);
    const download = await request.get(
      `${registry}/api/v1/packages/${packagePath}/versions/${version}/artifact/download`,
    );
    const downloadedBytes = await download.body();
    expect(download.status(), downloadedBytes.toString("utf8")).toBe(200);
    const downloadedSha256 = sha256(downloadedBytes);
    expect(downloadedSha256).toBe(artifactSha256);

    const retried = extractLastJsonObject((await runCli(publishArgs, cliEnv)).stdout);
    expect(retried).toMatchObject({
      publicationStatus: "published",
      artifactSha256,
    });

    const expectedInventory = [
      { kind: "skill", source: "clawhub", ref: "@acme/research", version: "1.2.3" },
      { kind: "skill", source: "bundled", path: "skills/research", name: "Bundled Research" },
      { kind: "plugin", source: "clawhub", ref: "@acme/alerts", version: "2.0.0" },
      { kind: "plugin", source: "bundled", path: "plugins/alerts", name: "Bundled Release Alerts" },
    ];
    const releaseResponse = await request.get(
      `${registry}/api/v1/packages/${packagePath}/versions/${version}`,
    );
    expect(releaseResponse.status()).toBe(200);
    const release = await releaseResponse.json();
    expect(release.version.templateInventory).toEqual(expectedInventory);
    expect(release.version.templateManifestSummary.packages).toEqual({
      skillCount: 2,
      pluginCount: 2,
    });
    expect(release.version.artifact.sha256).toBe(artifactSha256);

    await page.goto(`/cli-user/templates/${packageName}`);
    await expect(page.getByRole("heading", { name: "Exact Template Proof" })).toBeVisible();
    const proofDir = process.env.TEMPLATE_CONTRACT_PROOF_DIR;
    if (proofDir) {
      mkdirSync(proofDir, { recursive: true });
      writeFileSync(path.join(proofDir, "bundled-template-downloaded.tgz"), downloadedBytes);
    }
    for (const [label, width, height] of [
      ["desktop", 1440, 900],
      ["laptop", 1366, 768],
      ["tablet", 768, 1024],
      ["mobile", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const tab of ["Skills", "Plugins", "Automations"] as const) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await expect(page.getByRole("tabpanel")).toContainText(
          tab === "Skills" ? "@acme/research" : tab === "Plugins" ? "@acme/alerts" : "Paused",
        );
        if (tab !== "Automations") {
          await expect(page.getByRole("tabpanel")).toContainText(
            tab === "Skills" ? "Bundled Research" : "Bundled Release Alerts",
          );
          await expect(page.getByRole("tabpanel")).toContainText(
            tab === "Skills" ? "skills/research" : "plugins/alerts",
          );
          await expect(page.getByRole("tabpanel")).toContainText("Bundled");
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        if (proofDir)
          await page.screenshot({
            path: path.join(proofDir, `candidate-${label}-${tab.toLowerCase()}.png`),
            fullPage: true,
          });
      }
    }

    console.log(
      `EXACT_TEMPLATE_ARTIFACT_PROOF ${JSON.stringify({
        packageName,
        version,
        publicationStatus: published.publicationStatus,
        uploadedSha256: artifactSha256,
        attemptSha256: claim.claim.artifactFingerprint,
        responseSha256: published.artifactSha256,
        downloadedSha256,
        retrySha256: retried.artifactSha256,
      })}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
