/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiRoutes } from "clawhub-schema";
import { describe, expect, it } from "vitest";
import { readGlobalConfig } from "../packages/clawhub/src/config";
import {
  allowLiveMutations,
  buildE2ESkillMarkdown,
  fetchWithTimeout,
  getRegistry,
  getSite,
  getUserToken,
  makeTempConfig,
  mustGetToken,
} from "./helpers/clawhubCli";

const itIfLiveMutationsAndUserToken = allowLiveMutations() && getUserToken() ? it : it.skip;

function commandOutput(result: ReturnType<typeof spawnSync>) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function expectForbiddenCli(result: ReturnType<typeof spawnSync>) {
  expect(result.status).not.toBe(0);
  expect(commandOutput(result)).toMatch(/Forbidden|not authorized|not allowed|owner/i);
}

async function writeE2ECodePluginFixture(packageDir: string, packageName: string) {
  await mkdir(join(packageDir, "dist"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: packageName,
        displayName: `E2E ${packageName}`,
        version: "1.0.0",
        description: "Disposable ClawHub production permission e2e plugin fixture.",
        type: "module",
        main: "./dist/index.js",
        openclaw: {
          extensions: ["./dist/index.js"],
          compat: { pluginApi: ">=2026.3.24-beta.2" },
          build: { openclawVersion: "2026.3.24-beta.2" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(packageDir, "openclaw.plugin.json"),
    `${JSON.stringify(
      {
        id: `${packageName}.plugin`,
        name: `E2E ${packageName}`,
        configSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(packageDir, "dist", "index.js"),
    "export default function activate() { return { ok: true }; }\n",
    "utf8",
  );
  await writeFile(
    join(packageDir, "README.md"),
    `# ${packageName}\n\nDisposable production permission e2e package. It has no side effects and exists only to prove non-owner package actions are rejected.\n`,
    "utf8",
  );
}

describe("permission boundary e2e", () => {
  it("rejects unauthenticated protected write endpoints before mutation", async () => {
    const registry = getRegistry();
    const cases = [
      { method: "DELETE", path: `${ApiRoutes.skills}/gifgrep` },
      { method: "POST", path: `${ApiRoutes.skills}/gifgrep/undelete`, body: {} },
      {
        method: "POST",
        path: `${ApiRoutes.skills}/gifgrep/transfer`,
        body: { toUserHandle: "openclaw" },
      },
      { method: "DELETE", path: `${ApiRoutes.packages}/e2e-nonexistent-permission` },
      { method: "POST", path: `${ApiRoutes.packages}/e2e-nonexistent-permission/undelete` },
      {
        method: "POST",
        path: `${ApiRoutes.packages}/e2e-nonexistent-permission/transfer`,
        body: { toOwner: "openclaw" },
      },
      {
        method: "POST",
        path: `${ApiRoutes.packages}/e2e-nonexistent-permission/trusted-publisher`,
        body: {
          repository: "openclaw/clawhub",
          workflowFilename: "release.yml",
        },
      },
      {
        method: "DELETE",
        path: `${ApiRoutes.packages}/e2e-nonexistent-permission/trusted-publisher`,
      },
      { method: "POST", path: `${ApiRoutes.users}/restore`, body: { handle: "nobody" } },
      { method: "POST", path: `${ApiRoutes.users}/reclaim`, body: { handle: "nobody" } },
      { method: "POST", path: `${ApiRoutes.users}/reserve`, body: { handle: "nobody" } },
      { method: "POST", path: `${ApiRoutes.users}/publisher`, body: { handle: "nobody" } },
    ] as const;

    for (const testCase of cases) {
      const response = await fetchWithTimeout(new URL(testCase.path, registry), {
        method: testCase.method,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: "body" in testCase ? JSON.stringify(testCase.body) : undefined,
      });
      expect(response.status, `${testCase.method} ${testCase.path}`).toBe(401);
      expect(await response.text()).toMatch(/Unauthorized/i);
    }
  });

  itIfLiveMutationsAndUserToken(
    "rejects non-owner skill lifecycle and transfer actions",
    async () => {
      const registry = getRegistry();
      const site = getSite();
      const ownerToken = mustGetToken() ?? (await readGlobalConfig())?.token ?? null;
      const strangerToken = getUserToken();
      if (!ownerToken || !strangerToken) {
        throw new Error("Missing owner token or CLAWHUB_E2E_USER_TOKEN");
      }

      const ownerCfg = await makeTempConfig(registry, ownerToken);
      const strangerCfg = await makeTempConfig(registry, strangerToken);
      const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-permission-skill-"));
      const slug = `e2e-perm-${Date.now()}`;
      const skillDir = join(workdir, slug);
      const metaUrl = new URL(`${ApiRoutes.skills}/${slug}`, registry);

      try {
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, "SKILL.md"), buildE2ESkillMarkdown(slug), "utf8");

        const publish = spawnSync(
          "bun",
          [
            "clawhub",
            "publish",
            skillDir,
            "--slug",
            slug,
            "--name",
            `E2E ${slug}`,
            "--version",
            "1.0.0",
            "--tags",
            "latest",
            "--site",
            site,
            "--registry",
            registry,
            "--workdir",
            workdir,
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              CLAWHUB_CONFIG_PATH: ownerCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        expect(publish.status, commandOutput(publish)).toBe(0);

        const strangerEnv = {
          ...process.env,
          CLAWHUB_CONFIG_PATH: strangerCfg.path,
          CLAWHUB_DISABLE_TELEMETRY: "1",
        };
        const baseArgs = ["--site", site, "--registry", registry, "--workdir", workdir];

        expectForbiddenCli(
          spawnSync("bun", ["clawhub", "delete", slug, "--yes", ...baseArgs], {
            cwd: process.cwd(),
            env: strangerEnv,
            encoding: "utf8",
          }),
        );
        expectForbiddenCli(
          spawnSync(
            "bun",
            ["clawhub", "transfer", "request", slug, "openclaw", "--yes", ...baseArgs],
            {
              cwd: process.cwd(),
              env: strangerEnv,
              encoding: "utf8",
            },
          ),
        );
        const metaAfterDeniedActions = await fetchWithTimeout(metaUrl.toString(), {
          headers: { Accept: "application/json" },
        });
        expect(metaAfterDeniedActions.status).toBe(200);
      } finally {
        spawnSync(
          "bun",
          [
            "clawhub",
            "delete",
            slug,
            "--yes",
            "--site",
            site,
            "--registry",
            registry,
            "--workdir",
            workdir,
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              CLAWHUB_CONFIG_PATH: ownerCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        await rm(workdir, { recursive: true, force: true });
        await rm(ownerCfg.dir, { recursive: true, force: true });
        await rm(strangerCfg.dir, { recursive: true, force: true });
      }
    },
    180_000,
  );

  itIfLiveMutationsAndUserToken(
    "rejects non-owner package lifecycle and transfer actions",
    async () => {
      const registry = getRegistry();
      const site = getSite();
      const ownerToken = mustGetToken() ?? (await readGlobalConfig())?.token ?? null;
      const strangerToken = getUserToken();
      if (!ownerToken || !strangerToken) {
        throw new Error("Missing owner token or CLAWHUB_E2E_USER_TOKEN");
      }

      const ownerCfg = await makeTempConfig(registry, ownerToken);
      const strangerCfg = await makeTempConfig(registry, strangerToken);
      const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-permission-package-"));
      const packageName = `e2e-perm-plugin-${Date.now()}`;
      const packageDir = join(workdir, packageName);

      try {
        await mkdir(packageDir, { recursive: true });
        await writeE2ECodePluginFixture(packageDir, packageName);

        const publish = spawnSync(
          "bun",
          [
            "clawhub",
            "package",
            "publish",
            packageDir,
            "--source-repo",
            "openclaw/clawhub",
            "--source-commit",
            "0000000000000000000000000000000000000000",
            "--site",
            site,
            "--registry",
            registry,
            "--workdir",
            workdir,
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              CLAWHUB_CONFIG_PATH: ownerCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        expect(publish.status, commandOutput(publish)).toBe(0);

        const strangerEnv = {
          ...process.env,
          CLAWHUB_CONFIG_PATH: strangerCfg.path,
          CLAWHUB_DISABLE_TELEMETRY: "1",
        };
        const baseArgs = ["--site", site, "--registry", registry, "--workdir", workdir];

        expectForbiddenCli(
          spawnSync("bun", ["clawhub", "package", "delete", packageName, "--yes", ...baseArgs], {
            cwd: process.cwd(),
            env: strangerEnv,
            encoding: "utf8",
          }),
        );
        expectForbiddenCli(
          spawnSync(
            "bun",
            ["clawhub", "package", "transfer", packageName, "--to", "openclaw", ...baseArgs],
            {
              cwd: process.cwd(),
              env: strangerEnv,
              encoding: "utf8",
            },
          ),
        );
        const ownerInspect = spawnSync(
          "bun",
          ["clawhub", "package", "inspect", packageName, ...baseArgs],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              CLAWHUB_CONFIG_PATH: ownerCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        expect(ownerInspect.status, commandOutput(ownerInspect)).toBe(0);
      } finally {
        spawnSync(
          "bun",
          [
            "clawhub",
            "package",
            "delete",
            packageName,
            "--yes",
            "--site",
            site,
            "--registry",
            registry,
            "--workdir",
            workdir,
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              CLAWHUB_CONFIG_PATH: ownerCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        await rm(workdir, { recursive: true, force: true });
        await rm(ownerCfg.dir, { recursive: true, force: true });
        await rm(strangerCfg.dir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
