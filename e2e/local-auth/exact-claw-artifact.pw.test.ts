import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { completeMockPrePublicationChecks } from "./helpers";

test.setTimeout(180_000);

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "exact Claw artifact proof requires the local dev auth runner",
);

function localConvexDeployment() {
  const raw = readFileSync(".convex/local/default/config.json", "utf8");
  const parsed = JSON.parse(raw) as { deploymentName?: unknown };
  if (typeof parsed.deploymentName !== "string" || !parsed.deploymentName) {
    throw new Error("Local Convex deployment name was not available");
  }
  return `local:${parsed.deploymentName}`;
}

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

test("publishes, polls, retries, and downloads the exact Claw tarball", async ({ request }) => {
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
    mkdirSync(path.join(sourceDir, "profiles"), { recursive: true });
    writeFileSync(
      path.join(sourceDir, "package.json"),
      JSON.stringify({
        name: packageName,
        version,
        openclaw: { claw: "manifests/CLAW.md" },
      }),
    );
    writeFileSync(
      path.join(sourceDir, "manifests", "CLAW.md"),
      `---\nschemaVersion: 1\nagent:\n  id: ${packageName}\n  name: Exact Claw Proof\n---\nPreserve the exact published artifact.\n`,
    );
    writeFileSync(
      path.join(sourceDir, "profiles", "openclaw.yml"),
      "schemaVersion: 1\nagent: {}\n",
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
      "claw",
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

    console.log(
      `EXACT_CLAW_ARTIFACT_PROOF ${JSON.stringify({
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
