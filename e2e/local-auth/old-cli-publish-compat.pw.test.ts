import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type APIRequestContext, test } from "@playwright/test";
import {
  completeMockPrePublicationChecks,
  expectSingleMockPrePublicationCheckRejected,
} from "./helpers";

const OLD_CLI_VERSION = "0.14.0";

test.skip(
  process.env.VITE_ENABLE_DEV_AUTH !== "1",
  "old CLI compatibility requires the local dev auth runner",
);

test.setTimeout(600_000);

type CliRoleHelpTokens = {
  admin: { handle: string; token: string };
  user: { handle: string; token: string };
};

function extractLastJsonObject(output: string) {
  const trimmed = output.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{") continue;
    const candidate = trimmed.slice(index);
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Convex may print readiness lines before the JSON result.
    }
  }
  throw new Error(`No JSON object in Convex output:\n${output}`);
}

function seedCliTokens() {
  const result = spawnSync(
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
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to seed old CLI tokens:\n${result.stderr || result.stdout}`);
  }
  return extractLastJsonObject(result.stdout) as CliRoleHelpTokens;
}

function runOldCli(args: string[], configPath: string) {
  return spawnSync(
    "npm",
    ["exec", "--yes", "--package", `clawhub@${OLD_CLI_VERSION}`, "--", "clawhub", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined,
        ACTIONS_ID_TOKEN_REQUEST_URL: undefined,
        CLAWHUB_CONFIG_PATH: configPath,
        CLAWHUB_DISABLE_TELEMETRY: "1",
        GITHUB_ACTIONS: undefined,
      },
      timeout: 180_000,
    },
  );
}

async function writeCliConfig(root: string, registry: string, token: string) {
  const path = join(root, "config.json");
  await writeFile(path, `${JSON.stringify({ registry, token }, null, 2)}\n`, "utf8");
  return path;
}

async function writeSkillFixture(root: string, slug: string) {
  const skillDir = join(root, slug);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---
name: ${slug}
description: Verify staged publishing compatibility for older released ClawHub clients.
---

# ${slug}

## What it does

This skill verifies that a released older CLI can upload a complete skill package to the staged
publishing endpoint while the version remains unavailable through public APIs until automated
security checks finish.

## Usage

- Publish this directory with ClawHub CLI version ${OLD_CLI_VERSION}.
- Confirm the command exits successfully and returns a version identifier.
- Confirm the public version endpoint is unavailable while checks are pending.
- Complete clean TruffleHog and ClawScan checks.
- Confirm version 1.0.0 becomes public.

## Safety boundaries

This fixture contains no credentials, executable scripts, network calls, or environment-variable
values. Its documentation is deliberately specific so it passes the normal publish quality gate.
`,
    "utf8",
  );
  return skillDir;
}

async function writePluginFixture(root: string, name: string) {
  const pluginDir = join(root, name);
  await mkdir(join(pluginDir, "dist"), { recursive: true });
  await writeFile(
    join(pluginDir, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "1.0.0",
        type: "module",
        main: "dist/index.js",
        files: ["dist", "openclaw.plugin.json", "README.md"],
        openclaw: {
          extensions: ["./dist/index.js"],
          compat: { pluginApi: ">=2026.3.24-beta.2" },
          build: { openclawVersion: "2026.3.24-beta.2" },
          configSchema: { type: "object", additionalProperties: false },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(pluginDir, "openclaw.plugin.json"),
    `${JSON.stringify(
      {
        id: name,
        name: `Old CLI Plugin ${name}`,
        configSchema: { type: "object", additionalProperties: false },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(pluginDir, "README.md"),
    `# ${name}

This clean fixture verifies that a released older ClawHub CLI can upload a complete OpenClaw code
plugin while the release remains private until TruffleHog and ClawScan complete. It performs no
network access, reads no credentials, and exposes only a deterministic test registration function.
`,
    "utf8",
  );
  await writeFile(
    join(pluginDir, "dist", "index.js"),
    "export function register() { return { ok: true }; }\n",
    "utf8",
  );
  return pluginDir;
}

function registryUrl() {
  const url = process.env.VITE_CONVEX_SITE_URL?.replace(/\/$/u, "");
  if (!url) throw new Error("VITE_CONVEX_SITE_URL is required");
  return url;
}

async function expectSkillPublic(
  request: APIRequestContext,
  registry: string,
  ownerHandle: string,
  slug: string,
) {
  const response = await request.get(
    `${registry}/api/v1/skills/${encodeURIComponent(slug)}/versions/1.0.0?ownerHandle=${encodeURIComponent(
      ownerHandle,
    )}`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { version?: { version?: unknown } };
  expect(body.version?.version).toBe("1.0.0");
}

async function expectPluginPublic(request: APIRequestContext, registry: string, name: string) {
  const response = await request.get(
    `${registry}/api/v1/packages/${encodeURIComponent(name)}/versions/1.0.0`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    package?: { name?: unknown };
    version?: { version?: unknown };
  };
  expect(body.package?.name).toBe(name);
  expect(body.version?.version).toBe("1.0.0");
}

test("released CLI publishes skills and plugins only after both security checks pass", async ({
  request,
}) => {
  const registry = registryUrl();
  const tokens = seedCliTokens();
  const root = await mkdtemp(join(tmpdir(), "clawhub-old-cli-local-auth-"));
  const suffix = Date.now().toString(36);
  const slug = `old-cli-skill-${suffix}`;
  const packageName = `old-cli-plugin-${suffix}`;

  try {
    const skillDir = await writeSkillFixture(root, slug);
    const skillConfig = await writeCliConfig(root, registry, tokens.admin.token);
    const skillPublish = runOldCli(
      [
        "--site",
        registry,
        "--registry",
        registry,
        "--workdir",
        root,
        "publish",
        skillDir,
        "--slug",
        slug,
        "--name",
        `Old CLI Skill ${slug}`,
        "--version",
        "1.0.0",
        "--tags",
        "latest",
      ],
      skillConfig,
    );
    expect(skillPublish.status, skillPublish.stderr).toBe(0);
    expect(skillPublish.stderr).toContain(`OK. Published ${slug}@1.0.0`);

    const privateSkill = await request.get(
      `${registry}/api/v1/skills/${encodeURIComponent(
        slug,
      )}/versions/1.0.0?ownerHandle=${encodeURIComponent(tokens.admin.handle)}`,
    );
    expect(privateSkill.ok()).toBe(false);
    expect(await privateSkill.text()).toContain("currently unavailable");

    const skillClaim = await expectSingleMockPrePublicationCheckRejected({
      kind: "skill",
      slug,
      version: "1.0.0",
    });
    const skillAfterOnlyTruffleHog = await request.get(
      `${registry}/api/v1/skills/${encodeURIComponent(
        slug,
      )}/versions/1.0.0?ownerHandle=${encodeURIComponent(tokens.admin.handle)}`,
    );
    expect(skillAfterOnlyTruffleHog.ok()).toBe(false);

    await completeMockPrePublicationChecks({
      kind: "skill",
      slug,
      version: "1.0.0",
      claim: skillClaim,
    });
    await expect
      .poll(
        async () => {
          const response = await request.get(
            `${registry}/api/v1/skills/${encodeURIComponent(
              slug,
            )}/versions/1.0.0?ownerHandle=${encodeURIComponent(tokens.admin.handle)}`,
          );
          return response.status();
        },
        { timeout: 60_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(200);
    await expectSkillPublic(request, registry, tokens.admin.handle, slug);

    const pluginDir = await writePluginFixture(root, packageName);
    const pluginConfig = await writeCliConfig(root, registry, tokens.user.token);
    const pluginPublish = runOldCli(
      [
        "--site",
        registry,
        "--registry",
        registry,
        "--workdir",
        root,
        "package",
        "publish",
        pluginDir,
        "--family",
        "code-plugin",
        "--name",
        packageName,
        "--display-name",
        `Old CLI Plugin ${packageName}`,
        "--owner",
        tokens.user.handle,
        "--version",
        "1.0.0",
        "--tags",
        "latest",
        "--source-repo",
        "openclaw/clawhub",
        "--source-commit",
        "0123456789abcdef0123456789abcdef01234567",
      ],
      pluginConfig,
    );
    expect(pluginPublish.status, pluginPublish.stderr).toBe(0);
    expect(pluginPublish.stderr).toContain(`OK. Published ${packageName}@1.0.0`);

    const privatePlugin = await request.get(
      `${registry}/api/v1/packages/${encodeURIComponent(packageName)}/versions/1.0.0`,
    );
    expect(privatePlugin.ok()).toBe(false);

    const pluginClaim = await expectSingleMockPrePublicationCheckRejected({
      kind: "package",
      slug: packageName,
      version: "1.0.0",
    });
    const pluginAfterOnlyTruffleHog = await request.get(
      `${registry}/api/v1/packages/${encodeURIComponent(packageName)}/versions/1.0.0`,
    );
    expect(pluginAfterOnlyTruffleHog.ok()).toBe(false);

    await completeMockPrePublicationChecks({
      kind: "package",
      slug: packageName,
      version: "1.0.0",
      claim: pluginClaim,
    });
    await expect
      .poll(
        async () => {
          const response = await request.get(
            `${registry}/api/v1/packages/${encodeURIComponent(packageName)}/versions/1.0.0`,
          );
          return response.status();
        },
        { timeout: 60_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(200);
    await expectPluginPublic(request, registry, packageName);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
