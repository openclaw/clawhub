/* @vitest-environment node */

import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiRoutes,
  ApiV1SearchResponseSchema,
  ApiV1WhoamiResponseSchema,
  LegacyApiRoutes,
  parseArk,
} from "clawhub-schema";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readGlobalConfig } from "../packages/clawhub/src/config";
import { hashSkillFiles } from "../packages/clawhub/src/skills";
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

const itIfLiveMutations = allowLiveMutations() ? it : it.skip;
const itIfAdminAndUserTokens =
  (getAdminToken() && getUserToken()) || shouldSeedRoleHelpTokens() ? it : it.skip;

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function spawnCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  return await new Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
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
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

describe("clawhub e2e", () => {
  it("prints CLI version via --cli-version", async () => {
    const result = spawnSync("bun", ["clawhub", "--cli-version"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("search endpoint returns a results array (schema parse)", async () => {
    const registry = getRegistry();
    const url = new URL(ApiRoutes.search, registry);
    url.searchParams.set("q", "gif");
    url.searchParams.set("limit", "5");

    const response = await fetchWithTimeout(url.toString(), {
      headers: { Accept: "application/json" },
    });
    expect(response.ok).toBe(true);
    const json = (await response.json()) as unknown;
    const parsed = parseArk(ApiV1SearchResponseSchema, json, "API response");
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  it("cli search does not error on multi-result responses", async () => {
    const registry = getRegistry();
    const site = getSite();
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null;

    const cfg = await makeTempConfig(registry, token);
    try {
      const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-workdir-"));
      const result = spawnSync(
        "bun",
        [
          "clawhub",
          "search",
          "gif",
          "--limit",
          "5",
          "--site",
          site,
          "--registry",
          registry,
          "--workdir",
          workdir,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
          encoding: "utf8",
        },
      );
      await rm(workdir, { recursive: true, force: true });

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stderr).not.toMatch(/API response:/);
    } finally {
      await rm(cfg.dir, { recursive: true, force: true });
    }
  });

  it("cli scan rejects local folders before submitting a scan", async () => {
    let requestCount = 0;
    const server = createServer(async (_req, res) => {
      requestCount += 1;
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cfg = await makeTempConfig(registry, "test-token");
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-scan-"));
    try {
      const skillDir = join(workdir, "my-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Local Skill\n", "utf8");

      const result = await spawnCommand(
        "bun",
        [
          "clawhub",
          "scan",
          "./my-skill",
          "--workdir",
          workdir,
          "--site",
          registry,
          "--registry",
          registry,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAWHUB_CONFIG_PATH: cfg.path,
            CLAWHUB_DISABLE_TELEMETRY: "1",
          },
        },
      );

      expect(result.status).not.toBe(0);
      expect(requestCount).toBe(0);
      expect(result.stderr).toContain("Local folder scans are no longer supported");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(workdir, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
  });

  it("cli scan download fetches a stored submitted-version scan report", async () => {
    const reportZip = zipSync({
      "manifest.json": strToU8(
        `${JSON.stringify({
          scanId: "skill:demo-skill:1.2.3",
          sourceKind: "published",
          status: "succeeded",
        })}\n`,
      ),
      "clawscan.json": strToU8(`${JSON.stringify({ status: "malicious" })}\n`),
    });
    let requestedAuthorization = "";
    let requestedPath = "";
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      requestedPath = `${url.pathname}${url.search}`;
      if (
        req.method === "GET" &&
        url.pathname === `${ApiRoutes.skillScans}/download/demo-skill` &&
        url.searchParams.get("version") === "1.2.3" &&
        url.searchParams.get("kind") === "skill"
      ) {
        requestedAuthorization = req.headers.authorization ?? "";
        res.writeHead(200, { "Content-Type": "application/zip" });
        res.end(Buffer.from(reportZip));
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cfg = await makeTempConfig(registry, "test-token");
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-scan-download-"));
    try {
      const result = await spawnCommand(
        "bun",
        [
          "clawhub",
          "scan",
          "download",
          "demo-skill",
          "--version",
          "1.2.3",
          "--output",
          "report.zip",
          "--workdir",
          workdir,
          "--site",
          registry,
          "--registry",
          registry,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAWHUB_CONFIG_PATH: cfg.path,
            CLAWHUB_DISABLE_TELEMETRY: "1",
          },
        },
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(requestedAuthorization).toBe("Bearer test-token");
      expect(requestedPath).toBe(
        `${ApiRoutes.skillScans}/download/demo-skill?version=1.2.3&kind=skill`,
      );
      expect(result.stdout).toContain("Report ZIP:");
      const downloaded = await readFile(join(workdir, "report.zip"));
      expect(unzipSync(downloaded)).toHaveProperty("manifest.json");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(workdir, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
  });

  it("assumes a logged-in user (whoami succeeds)", async () => {
    const registry = getRegistry();
    const site = getSite();
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null;
    if (!token) {
      throw new Error("Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login");
    }

    const cfg = await makeTempConfig(registry, token);
    try {
      const whoamiUrl = new URL(ApiRoutes.whoami, registry);
      const whoamiRes = await fetchWithTimeout(whoamiUrl.toString(), {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
      expect(whoamiRes.ok).toBe(true);
      const whoami = parseArk(
        ApiV1WhoamiResponseSchema,
        (await whoamiRes.json()) as unknown,
        "Whoami",
      );
      expect(whoami.user).toBeTruthy();

      const result = spawnSync(
        "bun",
        ["clawhub", "whoami", "--site", site, "--registry", registry],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
          encoding: "utf8",
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).not.toMatch(/not logged in|unauthorized|error:/i);
    } finally {
      await rm(cfg.dir, { recursive: true, force: true });
    }
  });

  itIfAdminAndUserTokens("shows moderator CLI commands only in admin help", async () => {
    const registry = getRegistry();
    const site = getSite();
    const { adminToken, userToken } = await resolveRoleHelpTokens(registry);

    async function expectRole(token: string, expectedRole: "admin" | "user") {
      const whoamiUrl = new URL(ApiRoutes.whoami, registry);
      const response = await fetchWithTimeout(whoamiUrl.toString(), {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
      expect(response.ok).toBe(true);
      const whoami = parseArk(
        ApiV1WhoamiResponseSchema,
        (await response.json()) as unknown,
        "Whoami",
      );
      expect(whoami.user.role).toBe(expectedRole);
    }

    await expectRole(adminToken, "admin");
    await expectRole(userToken, "user");

    const adminCfg = await makeTempConfig(registry, adminToken);
    const userCfg = await makeTempConfig(registry, userToken);
    try {
      const baseEnv = { ...process.env, CLAWHUB_DISABLE_TELEMETRY: "1" };
      const adminResult = spawnSync(
        "bun",
        ["clawhub", "--registry", registry, "--site", site, "--help"],
        {
          cwd: process.cwd(),
          env: { ...baseEnv, CLAWHUB_CONFIG_PATH: adminCfg.path },
          encoding: "utf8",
        },
      );
      const userResult = spawnSync(
        "bun",
        ["clawhub", "--registry", registry, "--site", site, "--help"],
        {
          cwd: process.cwd(),
          env: { ...baseEnv, CLAWHUB_CONFIG_PATH: userCfg.path },
          encoding: "utf8",
        },
      );

      expect(adminResult.status).toBe(0);
      expect(adminResult.stdout).toContain("ban-user");
      expect(adminResult.stdout).toContain("unban-user");
      expect(adminResult.stdout).toContain("set-role");
      expect(userResult.status).toBe(0);
      expect(userResult.stdout).not.toContain("ban-user");
      expect(userResult.stdout).not.toContain("unban-user");
      expect(userResult.stdout).not.toContain("set-role");
    } finally {
      await rm(adminCfg.dir, { recursive: true, force: true });
      await rm(userCfg.dir, { recursive: true, force: true });
    }
  });

  it("sync dry-run finds skills from an explicit root", async () => {
    const registry = getRegistry();
    const site = getSite();
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null;
    if (!token) {
      throw new Error("Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login");
    }

    const cfg = await makeTempConfig(registry, token);
    const root = await mkdtemp(join(tmpdir(), "clawhub-e2e-sync-"));
    try {
      const skillDir = join(root, "cool-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Skill\n", "utf8");

      const result = spawnSync(
        "bun",
        [
          "clawhub",
          "sync",
          "--dry-run",
          "--all",
          "--root",
          root,
          "--site",
          site,
          "--registry",
          registry,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
          encoding: "utf8",
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).not.toMatch(/error:/i);
      expect(result.stdout).toMatch(/Dry run/i);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
  });

  it("sync continues after a per-skill publish failure", async () => {
    const publishedSlugs: string[] = [];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === ApiRoutes.whoami) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user: { handle: "tester" } }));
        return;
      }
      if (req.method === "GET" && url.pathname === ApiRoutes.resolve) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Skill not found");
        return;
      }
      if (req.method === "POST" && url.pathname === ApiRoutes.skills) {
        const body = await readRequestBody(req);
        const slug = body.includes('"slug":"failed-skill"') ? "failed-skill" : "successful-skill";
        publishedSlugs.push(slug);
        if (slug === "failed-skill") {
          res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Registry rejected failed-skill");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, skillId: "skill-successful", versionId: "version-1" }));
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cfg = await makeTempConfig(registry, "test-token");
    const root = await mkdtemp(join(tmpdir(), "clawhub-e2e-sync-publish-"));
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-sync-workdir-"));
    const stateDir = await mkdtemp(join(tmpdir(), "clawhub-e2e-sync-state-"));
    try {
      for (const slug of ["failed-skill", "successful-skill"]) {
        const skillDir = join(root, slug);
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, "SKILL.md"), `# ${slug}\n`, "utf8");
      }

      const result = await spawnCommand(
        "bun",
        [
          "clawhub",
          "sync",
          "--all",
          "--root",
          root,
          "--workdir",
          workdir,
          "--site",
          registry,
          "--registry",
          registry,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAWHUB_CONFIG_PATH: cfg.path,
            CLAWHUB_DISABLE_TELEMETRY: "1",
            CLAWDBOT_STATE_DIR: stateDir,
            OPENCLAW_STATE_DIR: stateDir,
          },
        },
      );

      expect(result.status).toBe(1);
      expect(publishedSlugs).toEqual(["failed-skill", "successful-skill"]);
      expect(result.stdout).toMatch(/Failed to upload/);
      expect(result.stdout).toMatch(/failed-skill: Registry rejected failed-skill/);
      expect(result.stdout).toMatch(/Uploaded 1 of 2 skill\(s\)\. 1 failed\./);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
      await rm(workdir, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
  });

  it("update resolves installed bundle fingerprints that include skill-card.md", async () => {
    let resolvedHash: string | null = null;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === `${ApiRoutes.skills}/demo`) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            skill: {
              slug: "demo",
              displayName: "Demo",
              summary: null,
              tags: {},
              stats: {},
              createdAt: 1,
              updatedAt: 1,
            },
            latestVersion: {
              version: "1.0.0",
              createdAt: 1,
              changelog: "init",
              license: "MIT-0",
            },
            owner: null,
            moderation: null,
          }),
        );
        return;
      }
      if (req.method === "GET" && url.pathname === ApiRoutes.resolve) {
        resolvedHash = url.searchParams.get("hash");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            match: { version: "1.0.0" },
            latestVersion: { version: "1.0.0" },
          }),
        );
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cfg = await makeTempConfig(registry, "test-token");
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-bundle-update-"));
    const skillMd = "# Demo\n";
    const skillCardMd = "# Skill Card\n";
    const expectedFingerprint = hashSkillFiles([
      { relPath: "SKILL.md", bytes: new TextEncoder().encode(skillMd) },
      { relPath: "skill-card.md", bytes: new TextEncoder().encode(skillCardMd) },
    ]).fingerprint;
    try {
      const skillDir = join(workdir, "skills", "demo");
      await mkdir(join(workdir, ".clawhub"), { recursive: true });
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(workdir, ".clawhub", "lock.json"),
        `${JSON.stringify({ version: 1, skills: { demo: { version: "1.0.0", installedAt: 1 } } }, null, 2)}\n`,
        "utf8",
      );
      await writeFile(join(skillDir, "SKILL.md"), skillMd, "utf8");
      await writeFile(join(skillDir, "skill-card.md"), skillCardMd, "utf8");

      const result = await spawnCommand(
        "bun",
        [
          "clawhub",
          "update",
          "demo",
          "--workdir",
          workdir,
          "--site",
          registry,
          "--registry",
          registry,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
        },
      );

      expect(result.status).toBe(0);
      expect(resolvedHash).toBe(expectedFingerprint);
      expect(result.stdout + result.stderr).toMatch(/up to date/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(workdir, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
  });

  it("installs a GitHub-backed skill through the install resolver and reports install telemetry", async () => {
    const commit = "b".repeat(40);
    const telemetryBodies: unknown[] = [];
    const requestLog: string[] = [];
    const githubZipBytes = zipSync({
      "skills-main/skills/aiq-deploy/SKILL.md": strToU8("# AIQ Deploy\n"),
      "skills-main/skills/aiq-deploy/skill-card.md": strToU8("# Card\n"),
      "skills-main/skills/other/SKILL.md": strToU8("# Other\n"),
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      requestLog.push(`${req.method ?? "GET"} ${url.pathname}`);
      if (req.method === "GET" && url.pathname === `${ApiRoutes.skills}/aiq-deploy`) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            skill: {
              slug: "aiq-deploy",
              displayName: "AIQ Deploy",
              summary: "Deploy AgentIQ workflows.",
              tags: {},
              stats: {},
              createdAt: 1,
              updatedAt: 1,
            },
            latestVersion: null,
            owner: null,
            moderation: null,
          }),
        );
        return;
      }
      if (req.method === "GET" && url.pathname === `${ApiRoutes.skills}/aiq-deploy/install`) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            slug: "aiq-deploy",
            installKind: "github",
            github: {
              repo: "NVIDIA/skills",
              path: "skills/aiq-deploy",
              commit,
              contentHash: "hash-aiq-deploy",
              sourceUrl: `https://github.com/NVIDIA/skills/tree/${commit}/skills/aiq-deploy`,
            },
          }),
        );
        return;
      }
      if (req.method === "GET" && url.pathname === `/NVIDIA/skills/zip/${commit}`) {
        res.writeHead(200, { "Content-Type": "application/zip" });
        res.end(Buffer.from(githubZipBytes));
        return;
      }
      if (req.method === "POST" && url.pathname === LegacyApiRoutes.cliTelemetryInstall) {
        telemetryBodies.push(JSON.parse(await readRequestBody(req)) as unknown);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cfg = await makeTempConfig(registry, "test-token");
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-github-install-"));
    try {
      const result = await spawnCommand(
        "bun",
        [
          "clawhub",
          "install",
          "aiq-deploy",
          "--workdir",
          workdir,
          "--site",
          registry,
          "--registry",
          registry,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAWHUB_CONFIG_PATH: cfg.path,
            CLAWHUB_DISABLE_TELEMETRY: "",
            CLAWDHUB_DISABLE_TELEMETRY: "",
            CLAWHUB_GITHUB_CODELOAD_BASE_URL: registry,
          },
        },
      );

      expect(result.status).toBe(0);
      await expect(
        readFile(join(workdir, "skills", "aiq-deploy", "SKILL.md"), "utf8"),
      ).resolves.toContain("# AIQ Deploy");
      await expect(
        readFile(join(workdir, "skills", "aiq-deploy", "skill-card.md"), "utf8"),
      ).resolves.toContain("# Card");
      await expect(
        readFile(join(workdir, "skills", "aiq-deploy", "other", "SKILL.md")),
      ).rejects.toThrow();
      if (telemetryBodies.length !== 1) {
        throw new Error(`Expected one install telemetry request, saw: ${requestLog.join(", ")}`);
      }
      expect(telemetryBodies[0]).toMatchObject({
        roots: [
          {
            skills: [{ slug: "aiq-deploy", version: commit }],
          },
        ],
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(workdir, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
  });

  it("sync dry-run finds skills from clawdbot.json roots", async () => {
    const registry = getRegistry();
    const site = getSite();
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null;
    if (!token) {
      throw new Error("Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login");
    }

    const cfg = await makeTempConfig(registry, token);
    const root = await mkdtemp(join(tmpdir(), "clawhub-e2e-clawdbot-"));
    const stateDir = join(root, "state");
    const configPath = join(root, "clawdbot.json");
    const workspace = join(root, "clawd-work");
    const skillsRoot = join(workspace, "skills");
    const skillDir = join(skillsRoot, "auto-skill");

    try {
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Skill\n", "utf8");

      const config = `{
        // JSON5-style comments + trailing commas
        routing: {
          agents: {
            work: { name: 'Work', workspace: '${workspace}', },
          },
        },
      }`;
      await writeFile(configPath, config, "utf8");

      const result = spawnSync(
        "bun",
        ["clawhub", "sync", "--dry-run", "--all", "--site", site, "--registry", registry],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAWHUB_CONFIG_PATH: cfg.path,
            CLAWHUB_DISABLE_TELEMETRY: "1",
            CLAWDBOT_CONFIG_PATH: configPath,
            CLAWDBOT_STATE_DIR: stateDir,
          },
          encoding: "utf8",
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).not.toMatch(/error:/i);
      expect(result.stdout).toMatch(/Dry run/i);
      expect(result.stdout).toMatch(/auto-skill/i);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
  });

  it("package publish --dry-run from a GitHub repo shows a summary", async () => {
    const registry = getRegistry();
    const site = getSite();
    const result = spawnSync(
      "bun",
      [
        "clawhub",
        "package",
        "publish",
        "pwrdrvr/openclaw-codex-app-server",
        "--dry-run",
        "--site",
        site,
        "--registry",
        registry,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, CLAWHUB_DISABLE_TELEMETRY: "1" },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Dry run/i);
    expect(result.stdout).toMatch(/openclaw-codex-app-server/);
    expect(result.stdout).toMatch(/code-plugin/i);
    expect(result.stdout).toMatch(/openclaw\.plugin\.json/);
  }, 30_000);

  it("package publish --dry-run --json from GitHub outputs valid JSON", async () => {
    const registry = getRegistry();
    const site = getSite();
    const result = spawnSync(
      "bun",
      [
        "clawhub",
        "package",
        "publish",
        "pwrdrvr/openclaw-codex-app-server",
        "--dry-run",
        "--json",
        "--site",
        site,
        "--registry",
        registry,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, CLAWHUB_DISABLE_TELEMETRY: "1" },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(String(output.name)).toMatch(/openclaw-codex-app-server/);
    expect(output.family).toBe("code-plugin");
    expect(Number(output.files)).toBeGreaterThan(0);
    expect(output).not.toHaveProperty("releaseId");
  }, 30_000);

  it("package publish help shows the new source argument and flags", async () => {
    const result = spawnSync("bun", ["clawhub", "package", "publish", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/<source>/);
    expect(result.stdout).toMatch(/--dry-run/);
    expect(result.stdout).toMatch(/--json/);
  });

  it("skill verify help omits the redundant json flag", async () => {
    const result = spawnSync("bun", ["clawhub", "skill", "verify", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/--version/);
    expect(result.stdout).toMatch(/--tag/);
    expect(result.stdout).toMatch(/--card/);
    expect(result.stdout).not.toMatch(/--json/);
  });

  it("skill verify accepts the legacy json flag with flattened verification responses", async () => {
    const requestLog: string[] = [];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      requestLog.push(`${req.method ?? "GET"} ${url.pathname}${url.search}`);
      if (req.method === "GET" && url.pathname === `${ApiRoutes.skills}/fulcra-context/verify`) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            schema: "clawhub.skill.verify.v1",
            ok: true,
            decision: "pass",
            reasons: [],
            slug: "fulcra-context",
            displayName: "Fulcra Context",
            pageUrl: "https://clawhub.ai/arc-claw-bot/fulcra-context",
            publisherHandle: "arc-claw-bot",
            publisherDisplayName: "Arc Claw Bot",
            publisherProfileUrl: "https://clawhub.ai/user/arc-claw-bot",
            version: "1.4.10",
            resolvedFrom: "version",
            tag: null,
            createdAt: 1780075196459,
            card: {
              available: true,
              path: "skill-card.md",
              url: `${registry}/api/v1/skills/fulcra-context/card?version=1.4.10`,
              sha256: "f6d6dc3701e5fea5116526261c73031030b06a6110e57fdc3ed4de7df8f315dd",
              size: 3285,
              contentType: "text/markdown",
            },
            artifact: {
              sourceFingerprint: "source-fingerprint",
              bundleFingerprints: ["generated-bundle-fingerprint"],
              files: [
                {
                  path: "SKILL.md",
                  size: 5929,
                  sha256: "db813e41699340098840b6ba2ed958f1ae53fb620e4cc1cb0aa03aabfd1a4dbc",
                },
              ],
            },
            provenance: { source: "unavailable" },
            security: {
              status: "clean",
              passed: true,
              rawStatus: "clean",
              verdict: "benign",
              confidence: "high",
              summary: "Docs-only skill with bounded Fulcra read workflows.",
              model: "gpt-5.5",
              checkedAt: 1780082252374,
              signals: {
                staticScan: { status: "clean", rawStatus: "clean", reasonCodes: [] },
                virusTotal: { status: "clean", rawStatus: "clean", source: "engines" },
                skillSpector: {
                  status: "clean",
                  rawStatus: "clean",
                  score: 0,
                  severity: "LOW",
                  recommendation: "SAFE",
                  issueCount: 0,
                },
                dependencyRegistry: { status: "clean" },
              },
            },
            signature: { status: "unsigned" },
          }),
        );
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cfg = await makeTempConfig(registry, "test-token");
    try {
      const result = await spawnCommand(
        "bun",
        [
          "clawhub",
          "skill",
          "verify",
          "fulcra-context",
          "--version",
          "1.4.10",
          "--json",
          "--site",
          registry,
          "--registry",
          registry,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).not.toMatch(/unknown option|API response:/i);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(output).toMatchObject({
        ok: true,
        decision: "pass",
        reasons: [],
        slug: "fulcra-context",
        publisherHandle: "arc-claw-bot",
        version: "1.4.10",
      });
      expect(output).not.toHaveProperty("skill");
      expect(output).not.toHaveProperty("publisher");
      expect(requestLog).toEqual(["GET /api/v1/skills/fulcra-context/verify?version=1.4.10"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(cfg.dir, { recursive: true, force: true });
    }
  });

  itIfLiveMutations(
    "publishes, deletes, and undeletes a skill (logged-in)",
    async () => {
      const registry = getRegistry();
      const site = getSite();
      const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null;
      if (!token) {
        throw new Error("Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login");
      }

      const cfg = await makeTempConfig(registry, token);
      const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-publish-"));
      const installWorkdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-install-"));
      const slug = `e2e-${Date.now()}`;
      const skillDir = join(workdir, slug);

      try {
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, "SKILL.md"), buildE2ESkillMarkdown(slug), "utf8");

        const publish1 = spawnSync(
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
            env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
            encoding: "utf8",
          },
        );
        expect(publish1.status).toBe(0);
        expect(publish1.stderr).not.toMatch(/changelog required/i);

        const publish2 = spawnSync(
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
            "1.0.1",
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
            env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
            encoding: "utf8",
          },
        );
        expect(publish2.status).toBe(0);
        expect(publish2.stderr).not.toMatch(/changelog required/i);

        const downloadUrl = new URL(ApiRoutes.download, registry);
        downloadUrl.searchParams.set("slug", slug);
        downloadUrl.searchParams.set("version", "1.0.1");
        const zipRes = await fetchWithTimeout(downloadUrl.toString());
        expect(zipRes.ok).toBe(true);
        const zipBytes = new Uint8Array(await zipRes.arrayBuffer());
        const unzipped = unzipSync(zipBytes);
        expect(Object.keys(unzipped)).toContain("SKILL.md");

        const install = spawnSync(
          "bun",
          [
            "clawhub",
            "install",
            slug,
            "--version",
            "1.0.0",
            "--force",
            "--site",
            site,
            "--registry",
            registry,
            "--workdir",
            installWorkdir,
          ],
          {
            cwd: process.cwd(),
            env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
            encoding: "utf8",
          },
        );
        expect(install.status).toBe(0);

        const list = spawnSync(
          "bun",
          ["clawhub", "list", "--site", site, "--registry", registry, "--workdir", installWorkdir],
          {
            cwd: process.cwd(),
            env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
            encoding: "utf8",
          },
        );
        expect(list.status).toBe(0);
        expect(list.stdout).toMatch(new RegExp(`${slug}\\s+1\\.0\\.0`));

        const update = spawnSync(
          "bun",
          [
            "clawhub",
            "update",
            slug,
            "--force",
            "--site",
            site,
            "--registry",
            registry,
            "--workdir",
            installWorkdir,
          ],
          {
            cwd: process.cwd(),
            env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
            encoding: "utf8",
          },
        );
        expect(update.status).toBe(0);

        const metaUrl = new URL(`${ApiRoutes.skills}/${slug}`, registry);
        const metaRes = await fetchWithTimeout(metaUrl.toString(), {
          headers: { Accept: "application/json" },
        });
        expect(metaRes.status).toBe(200);

        const del = spawnSync(
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
            env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
            encoding: "utf8",
          },
        );
        expect(del.status).toBe(0);

        const metaAfterDelete = await fetchWithTimeout(metaUrl.toString(), {
          headers: { Accept: "application/json" },
        });
        expect(metaAfterDelete.status).toBe(404);

        const downloadAfterDelete = await fetchWithTimeout(downloadUrl.toString());
        expect(downloadAfterDelete.status).toBe(404);

        const undelete = spawnSync(
          "bun",
          [
            "clawhub",
            "undelete",
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
            env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
            encoding: "utf8",
          },
        );
        expect(undelete.status).toBe(0);

        const metaAfterUndelete = await fetchWithTimeout(metaUrl.toString(), {
          headers: { Accept: "application/json" },
        });
        expect(metaAfterUndelete.status).toBe(200);
      } finally {
        const cleanup = spawnSync(
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
            env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
            encoding: "utf8",
          },
        );
        if (cleanup.status !== 0) {
          // best-effort cleanup
        }
        await rm(workdir, { recursive: true, force: true });
        await rm(installWorkdir, { recursive: true, force: true });
        await rm(cfg.dir, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it("delete returns proper error for non-existent skill", async () => {
    const registry = getRegistry();
    const site = getSite();
    const token = mustGetToken() ?? (await readGlobalConfig())?.token ?? null;
    if (!token) {
      throw new Error("Missing token. Set CLAWHUB_E2E_TOKEN or run: bun clawhub auth login");
    }

    const cfg = await makeTempConfig(registry, token);
    const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-delete-"));
    const nonExistentSlug = `non-existent-skill-${Date.now()}`;

    try {
      const del = spawnSync(
        "bun",
        [
          "clawhub",
          "delete",
          nonExistentSlug,
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
          env: { ...process.env, CLAWHUB_CONFIG_PATH: cfg.path, CLAWHUB_DISABLE_TELEMETRY: "1" },
          encoding: "utf8",
        },
      );
      // Should fail with non-zero exit code
      expect(del.status).not.toBe(0);
      // Error should mention "not found" - not generic "Unauthorized"
      const output = (del.stdout + del.stderr).toLowerCase();
      expect(output).toMatch(/not found|404|does not exist/i);
      expect(output).not.toMatch(/unauthorized/i);
    } finally {
      await rm(workdir, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
  }, 30_000);
});
