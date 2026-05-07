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
  getAdminToken,
  getRegistry,
  getSite,
  getUserToken,
  makeTempConfig,
  mustGetToken,
  resolveRoleHelpTokens,
  shouldSeedRoleHelpTokens,
} from "./helpers/clawhubCli";

const itIfLiveMutationsAndRoleTokens =
  allowLiveMutations() && ((getAdminToken() && getUserToken()) || shouldSeedRoleHelpTokens())
    ? it
    : it.skip;

async function writeE2ECodePluginFixture(packageDir: string, packageName: string) {
  await mkdir(join(packageDir, "dist"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: packageName,
        displayName: `E2E ${packageName}`,
        version: "1.0.0",
        description: "ClawHub artifact moderation e2e plugin fixture.",
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
    `${JSON.stringify({ id: `${packageName}.plugin`, name: `E2E ${packageName}` }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(packageDir, "dist", "index.js"),
    "export default function activate() { return { ok: true }; }\n",
    "utf8",
  );
  await writeFile(join(packageDir, "README.md"), `# ${packageName}\n`, "utf8");
}

describe("artifact moderation e2e", () => {
  itIfLiveMutationsAndRoleTokens(
    "runs the skill report, enforcement, appeal, and restore loop",
    async () => {
      const registry = getRegistry();
      const site = getSite();
      const ownerToken = mustGetToken() ?? (await readGlobalConfig())?.token ?? null;
      if (!ownerToken) {
        throw new Error("Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login");
      }
      const { adminToken, userToken } = await resolveRoleHelpTokens(registry);

      const ownerCfg = await makeTempConfig(registry, ownerToken);
      const reporterCfg = await makeTempConfig(registry, userToken);
      const adminCfg = await makeTempConfig(registry, adminToken);
      const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-moderation-"));
      const slug = `e2e-mod-${Date.now()}`;
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
        expect(publish.status).toBe(0);

        const report = spawnSync(
          "bun",
          [
            "clawhub",
            "skill",
            "report",
            slug,
            "--reason",
            "E2E moderation report",
            "--json",
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
              CLAWHUB_CONFIG_PATH: reporterCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        expect(report.status).toBe(0);
        const reportJson = JSON.parse(report.stdout.trim()) as { reportId: string };
        expect(reportJson.reportId).toBeTruthy();

        const triage = spawnSync(
          "bun",
          [
            "clawhub",
            "skill",
            "triage-report",
            reportJson.reportId,
            "--status",
            "confirmed",
            "--note",
            "E2E confirmed report",
            "--action",
            "hide",
            "--yes",
            "--json",
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
              CLAWHUB_CONFIG_PATH: adminCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        expect(triage.status).toBe(0);
        expect(JSON.parse(triage.stdout.trim())).toMatchObject({ actionTaken: "hide" });

        const metaAfterHide = await fetchWithTimeout(metaUrl.toString(), {
          headers: { Accept: "application/json" },
        });
        expect(metaAfterHide.status).toBe(404);

        const appeal = spawnSync(
          "bun",
          [
            "clawhub",
            "skill",
            "appeal",
            slug,
            "--message",
            "E2E false positive appeal",
            "--json",
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
        expect(appeal.status).toBe(0);
        const appealJson = JSON.parse(appeal.stdout.trim()) as { appealId: string };
        expect(appealJson.appealId).toBeTruthy();

        const resolveAppeal = spawnSync(
          "bun",
          [
            "clawhub",
            "skill",
            "resolve-appeal",
            appealJson.appealId,
            "--status",
            "accepted",
            "--note",
            "E2E false positive confirmed",
            "--action",
            "restore",
            "--yes",
            "--json",
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
              CLAWHUB_CONFIG_PATH: adminCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        expect(resolveAppeal.status).toBe(0);
        expect(JSON.parse(resolveAppeal.stdout.trim())).toMatchObject({ actionTaken: "restore" });

        const metaAfterRestore = await fetchWithTimeout(metaUrl.toString(), {
          headers: { Accept: "application/json" },
        });
        expect(metaAfterRestore.status).toBe(200);
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
        await rm(reporterCfg.dir, { recursive: true, force: true });
        await rm(adminCfg.dir, { recursive: true, force: true });
      }
    },
    180_000,
  );

  itIfLiveMutationsAndRoleTokens(
    "runs the package report, enforcement, appeal, and approve loop",
    async () => {
      const registry = getRegistry();
      const site = getSite();
      const ownerToken = mustGetToken() ?? (await readGlobalConfig())?.token ?? null;
      if (!ownerToken) {
        throw new Error("Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login");
      }
      const { adminToken, userToken } = await resolveRoleHelpTokens(registry);

      const ownerCfg = await makeTempConfig(registry, ownerToken);
      const reporterCfg = await makeTempConfig(registry, userToken);
      const adminCfg = await makeTempConfig(registry, adminToken);
      const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-package-moderation-"));
      const packageName = `e2e-plugin-${Date.now()}`;
      const packageDir = join(workdir, packageName);
      const artifactUrl = new URL(
        `${ApiRoutes.packages}/${packageName}/versions/1.0.0/artifact/download`,
        registry,
      );

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
        expect(publish.status).toBe(0);

        const report = spawnSync(
          "bun",
          [
            "clawhub",
            "package",
            "report",
            packageName,
            "--version",
            "1.0.0",
            "--reason",
            "E2E plugin moderation report",
            "--json",
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
              CLAWHUB_CONFIG_PATH: reporterCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        expect(report.status).toBe(0);
        const reportJson = JSON.parse(report.stdout.trim()) as { reportId: string };
        expect(reportJson.reportId).toBeTruthy();

        const triage = spawnSync(
          "bun",
          [
            "clawhub",
            "package",
            "triage-report",
            reportJson.reportId,
            "--status",
            "confirmed",
            "--note",
            "E2E confirmed plugin report",
            "--action",
            "quarantine",
            "--yes",
            "--json",
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
              CLAWHUB_CONFIG_PATH: adminCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        expect(triage.status).toBe(0);
        expect(JSON.parse(triage.stdout.trim())).toMatchObject({ actionTaken: "quarantine" });

        const artifactAfterQuarantine = await fetchWithTimeout(artifactUrl.toString());
        expect(artifactAfterQuarantine.status).toBe(403);

        const appeal = spawnSync(
          "bun",
          [
            "clawhub",
            "package",
            "appeal",
            packageName,
            "--version",
            "1.0.0",
            "--message",
            "E2E plugin false positive appeal",
            "--json",
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
        expect(appeal.status).toBe(0);
        const appealJson = JSON.parse(appeal.stdout.trim()) as { appealId: string };
        expect(appealJson.appealId).toBeTruthy();

        const resolveAppeal = spawnSync(
          "bun",
          [
            "clawhub",
            "package",
            "resolve-appeal",
            appealJson.appealId,
            "--status",
            "accepted",
            "--note",
            "E2E plugin false positive confirmed",
            "--action",
            "approve",
            "--yes",
            "--json",
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
              CLAWHUB_CONFIG_PATH: adminCfg.path,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
        expect(resolveAppeal.status).toBe(0);
        expect(JSON.parse(resolveAppeal.stdout.trim())).toMatchObject({ actionTaken: "approve" });

        const artifactAfterApprove = await fetchWithTimeout(artifactUrl.toString());
        expect(artifactAfterApprove.status).toBe(200);
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
        await rm(reporterCfg.dir, { recursive: true, force: true });
        await rm(adminCfg.dir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
