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
const itIfLocalRoleHelpMutations =
  allowLiveMutations() && shouldSeedRoleHelpTokens() ? it : it.skip;

async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function startPackagePublishRegistry(
  handler: (req: IncomingMessage, body: string) => { status: number; body: unknown; text?: true },
) {
  const server = createServer(async (req, res) => {
    const body = await readRequestBody(req);
    if (req.method !== "POST" || !req.url?.startsWith(ApiRoutes.packages)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    const response = handler(req, body);
    res.writeHead(response.status, {
      "Content-Type": response.text ? "text/plain" : "application/json",
    });
    res.end(response.text ? String(response.body) : JSON.stringify(response.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    registry: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function writeCodePluginFixture(root: string, name: string) {
  const folder = join(root, name);
  await mkdir(join(folder, "dist"), { recursive: true });
  await writeFile(
    join(folder, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "1.0.0",
        type: "module",
        main: "dist/index.js",
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
    join(folder, "openclaw.plugin.json"),
    `${JSON.stringify(
      {
        id: name,
        name,
        configSchema: { type: "object", additionalProperties: false },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(folder, "dist", "index.js"), "export const demo = true;\n", "utf8");
  return folder;
}

async function spawnCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; encoding?: BufferEncoding; timeoutMs?: number },
) {
  return await new Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    let settled = false;
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
    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            child.kill("SIGTERM");
            reject(new Error(`${command} ${args.join(" ")} timed out`));
          }, options.timeoutMs)
        : null;
    child.on("error", (error) => {
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status, signal) => {
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

type PublishMultipartArgs = {
  registry: string;
  token: string;
  slug: string;
  ownerHandle?: string;
  version: string;
  displayName?: string;
  changelog?: string;
  markdown?: string;
};

type SkillDetailBody = {
  skill?: { slug?: unknown };
  latestVersion?: { version?: unknown } | null;
  owner?: { handle?: unknown };
};

type SkillVersionsBody = {
  items?: Array<{ version?: unknown }>;
  nextCursor?: string | null;
};

function extractLastJsonObject(output: string) {
  const trimmed = output.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{") continue;
    const candidate = trimmed.slice(index);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Convex can print status lines before the JSON payload.
    }
  }
  throw new Error(`No JSON object in convex run output:\n${output}`);
}

function runConvexJson<T>(functionName: string, args: Record<string, unknown>) {
  const result = spawnSync(
    "bunx",
    ["convex", "run", "--no-push", functionName, JSON.stringify(args)],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `convex run ${functionName} failed:\n${result.stderr || result.stdout || "no output"}`,
    );
  }
  return JSON.parse(extractLastJsonObject(result.stdout)) as T;
}

async function createOrgPublisher(params: {
  registry: string;
  token: string;
  handle: string;
  displayName: string;
}) {
  const response = await fetchWithTimeout(
    new URL(ApiRoutes.publishers, params.registry).toString(),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ handle: params.handle, displayName: params.displayName }),
    },
    60_000,
  );
  if (response.status !== 201) {
    throw new Error(
      `create publisher ${params.handle} failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as { handle?: unknown; publisherId?: unknown };
}

async function publishSkillMultipart(params: PublishMultipartArgs) {
  const payload: Record<string, unknown> = {
    slug: params.slug,
    displayName: params.displayName ?? `E2E ${params.slug}`,
    version: params.version,
    changelog: params.changelog ?? `Publish ${params.version}`,
    acceptLicenseTerms: true,
    tags: ["latest"],
  };
  if (params.ownerHandle) payload.ownerHandle = params.ownerHandle;

  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  form.append(
    "files",
    new Blob([params.markdown ?? buildE2ESkillMarkdown(params.slug)], { type: "text/markdown" }),
    "SKILL.md",
  );

  const response = await fetchWithTimeout(
    new URL(ApiRoutes.skills, params.registry).toString(),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.token}`,
      },
      body: form,
    },
    60_000,
  );
  if (response.status !== 200) {
    throw new Error(
      `publish ${params.ownerHandle ? `@${params.ownerHandle}/` : ""}${params.slug}@${
        params.version
      } failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as { skillId?: unknown; versionId?: unknown };
}

async function readScopedSkill(registry: string, slug: string, ownerHandle: string) {
  const url = new URL(`${ApiRoutes.skills}/${encodeURIComponent(slug)}`, registry);
  url.searchParams.set("ownerHandle", ownerHandle);
  const response = await fetchWithTimeout(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (response.status !== 200) {
    throw new Error(
      `read @${ownerHandle}/${slug} failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as SkillDetailBody;
}

async function readScopedSkillVersions(registry: string, slug: string, ownerHandle: string) {
  const url = new URL(`${ApiRoutes.skills}/${encodeURIComponent(slug)}/versions`, registry);
  url.searchParams.set("ownerHandle", ownerHandle);
  url.searchParams.set("limit", "10");
  const response = await fetchWithTimeout(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (response.status !== 200) {
    throw new Error(
      `read @${ownerHandle}/${slug} versions failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as SkillVersionsBody;
}

async function expectUnscopedSkillAmbiguous(registry: string, slug: string) {
  const response = await fetchWithTimeout(
    new URL(`${ApiRoutes.skills}/${encodeURIComponent(slug)}`, registry).toString(),
    { headers: { Accept: "text/plain" } },
  );
  expect(response.status).toBe(409);
  const message = await response.text();
  expect(message).toContain("Ambiguous skill slug");
  expect(message).toContain(`/api/v1/skills/${slug}?ownerHandle=<owner>`);
}

describe("clawhub e2e", () => {
  it("prints CLI version via --cli-version", async () => {
    const result = spawnSync("bun", ["clawhub", "--cli-version"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
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
      const result = await spawnCommand(
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

  itIfAdminAndUserTokens("does not expose removed admin compatibility aliases", async () => {
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
      expect(adminResult.stdout).not.toContain("ban-user");
      expect(adminResult.stdout).not.toContain("unban-user");
      expect(adminResult.stdout).not.toContain("set-role");
      expect(userResult.status).toBe(0);
      expect(userResult.stdout).not.toContain("ban-user");
      expect(userResult.stdout).not.toContain("unban-user");
      expect(userResult.stdout).not.toContain("set-role");
    } finally {
      await rm(adminCfg.dir, { recursive: true, force: true });
      await rm(userCfg.dir, { recursive: true, force: true });
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

  it("package publish --dry-run from a GitHub repo shows a summary", async () => {
    const registry = getRegistry();
    const site = getSite();
    const result = spawnSync(
      "bun",
      [
        "clawhub",
        "package",
        "publish",
        "openclaw/openclaw",
        "--source-path",
        "extensions/cohere",
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

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/Dry run/i);
    expect(result.stdout).toMatch(/@openclaw\/cohere-provider/);
    expect(result.stdout).toMatch(/code-plugin/i);
    expect(result.stdout).toMatch(/openclaw\.plugin\.json/);
  }, 30_000);

  it("package publish --dry-run --json outputs valid JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-cli-dry-run-json-"));
    const registry = getRegistry();
    const site = getSite();
    try {
      const plugin = await writeCodePluginFixture(root, "clawhub-json-dry-run");
      const result = spawnSync(
        "bun",
        [
          "clawhub",
          "package",
          "publish",
          plugin,
          "--dry-run",
          "--json",
          "--source-repo",
          "openclaw/clawhub",
          "--source-commit",
          "0000000000000000000000000000000000000000",
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

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const output = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
      expect(output.name).toBe("clawhub-json-dry-run");
      expect(output.family).toBe("code-plugin");
      expect(Number(output.files)).toBeGreaterThan(0);
      expect(output).not.toHaveProperty("releaseId");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("package publish exits non-zero when Plugin Inspector hard errors block publish", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-cli-inspector-hard-"));
    const registry = await startPackagePublishRegistry(() => ({
      status: 400,
      text: true,
      body: "Plugin Inspector blocked publish: missing-expected-seam: missing expected registration registerTool",
    }));
    const cfg = await makeTempConfig(registry.registry, "test-token");
    try {
      const plugin = await writeCodePluginFixture(root, "cli-inspector-hard-plugin");
      const result = await spawnCommand(
        "node",
        [
          join(process.cwd(), "packages/clawhub/dist/cli.js"),
          "package",
          "publish",
          plugin,
          "--registry",
          registry.registry,
          "--site",
          registry.registry,
          "--source-repo",
          "openclaw/cli-inspector-hard-plugin",
          "--source-commit",
          "deadbeef",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAWHUB_CONFIG_PATH: cfg.path,
            CLAWHUB_DISABLE_TELEMETRY: "1",
            NO_COLOR: "1",
          },
          timeoutMs: 25_000,
        },
      );

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/Plugin Inspector blocked publish/);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/missing-expected-seam/);
    } finally {
      await registry.close();
      await rm(root, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("package publish exits zero and prints Plugin Inspector warnings", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-cli-inspector-warning-"));
    const registry = await startPackagePublishRegistry(() => ({
      status: 200,
      body: {
        ok: true,
        packageId: "pkg_cli_warning",
        releaseId: "rel_cli_warning",
        inspectorFindings: [
          {
            findingKind: "warning",
            code: "legacy-before-agent-start",
            issueClass: "deprecation-warning",
            message: "legacy before_agent_start hook is deprecated",
          },
        ],
      },
    }));
    const cfg = await makeTempConfig(registry.registry, "test-token");
    try {
      const plugin = await writeCodePluginFixture(root, "cli-inspector-warning-plugin");
      const result = await spawnCommand(
        "node",
        [
          join(process.cwd(), "packages/clawhub/dist/cli.js"),
          "package",
          "publish",
          plugin,
          "--registry",
          registry.registry,
          "--site",
          registry.registry,
          "--source-repo",
          "openclaw/cli-inspector-warning-plugin",
          "--source-commit",
          "abc123",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAWHUB_CONFIG_PATH: cfg.path,
            CLAWHUB_DISABLE_TELEMETRY: "1",
            NO_COLOR: "1",
          },
          timeoutMs: 25_000,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Plugin Inspector findings: 1 warning/);
      expect(result.stdout).toMatch(
        /WARNING legacy-before-agent-start \(deprecation-warning\): legacy before_agent_start hook is deprecated/,
      );
    } finally {
      await registry.close();
      await rm(root, { recursive: true, force: true });
      await rm(cfg.dir, { recursive: true, force: true });
    }
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
                dependencyRegistry: null,
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

  itIfLocalRoleHelpMutations(
    "publishes the same slug under separate org namespaces and appends versions in the selected org",
    async () => {
      const registry = getRegistry();
      const { adminToken } = await resolveRoleHelpTokens(registry);
      const suffix = Date.now().toString(36);
      const slug = `org-scope-e2e-${suffix}`;
      const orgAHandle = `org-a-${suffix}`;
      const orgBHandle = `org-b-${suffix}`;

      const orgA = await createOrgPublisher({
        registry,
        token: adminToken,
        handle: orgAHandle,
        displayName: `Org A ${suffix}`,
      });
      const orgB = await createOrgPublisher({
        registry,
        token: adminToken,
        handle: orgBHandle,
        displayName: `Org B ${suffix}`,
      });
      expect(orgA.handle).toBe(orgAHandle);
      expect(orgB.handle).toBe(orgBHandle);

      const firstOrgAPublish = await publishSkillMultipart({
        registry,
        token: adminToken,
        slug,
        ownerHandle: orgAHandle,
        version: "1.0.0",
        changelog: "first org-a owner-scoped publish",
      });
      expect(typeof firstOrgAPublish.skillId).toBe("string");
      expect(typeof firstOrgAPublish.versionId).toBe("string");

      // Authless availability checks namespace occupancy; authenticated owners can still publish new versions.
      const orgAAvailability = runConvexJson<{
        available: boolean;
        reason: string;
        message: string | null;
      }>("skills:checkSlugAvailability", { slug, ownerHandle: orgAHandle });
      expect(orgAAvailability).toMatchObject({ available: false, reason: "taken" });

      const orgBAvailability = runConvexJson<{
        available: boolean;
        reason: string;
      }>("skills:checkSlugAvailability", { slug, ownerHandle: orgBHandle });
      expect(orgBAvailability).toMatchObject({ available: true, reason: "available" });

      const orgBPublish = await publishSkillMultipart({
        registry,
        token: adminToken,
        slug,
        ownerHandle: orgBHandle,
        version: "1.0.0",
        changelog: "same slug in org-b namespace",
      });
      expect(typeof orgBPublish.skillId).toBe("string");
      expect(orgBPublish.skillId).not.toBe(firstOrgAPublish.skillId);

      const secondOrgAPublish = await publishSkillMultipart({
        registry,
        token: adminToken,
        slug,
        ownerHandle: orgAHandle,
        version: "1.0.1",
        changelog: "second org-a version should target the existing skill",
      });
      expect(secondOrgAPublish.skillId).toBe(firstOrgAPublish.skillId);
      expect(secondOrgAPublish.versionId).not.toBe(firstOrgAPublish.versionId);

      const orgARead = await readScopedSkill(registry, slug, orgAHandle);
      expect(orgARead.skill?.slug).toBe(slug);
      expect(orgARead.owner?.handle).toBe(orgAHandle);
      expect(orgARead.latestVersion?.version).toBe("1.0.1");

      const orgBRead = await readScopedSkill(registry, slug, orgBHandle);
      expect(orgBRead.skill?.slug).toBe(slug);
      expect(orgBRead.owner?.handle).toBe(orgBHandle);
      expect(orgBRead.latestVersion?.version).toBe("1.0.0");

      const orgAVersions = await readScopedSkillVersions(registry, slug, orgAHandle);
      expect(orgAVersions.items?.map((item) => item.version)).toEqual(
        expect.arrayContaining(["1.0.0", "1.0.1"]),
      );

      const orgBVersions = await readScopedSkillVersions(registry, slug, orgBHandle);
      expect(orgBVersions.items?.map((item) => item.version)).toEqual(["1.0.0"]);

      await expectUnscopedSkillAmbiguous(registry, slug);
    },
    180_000,
  );

  itIfLocalRoleHelpMutations(
    "preserves old ownerless publish payloads as personal-namespace publishes",
    async () => {
      const registry = getRegistry();
      const { adminToken, userToken } = await resolveRoleHelpTokens(registry);
      const slug = `old-ownerless-e2e-${Date.now().toString(36)}`;

      const adminPublish = await publishSkillMultipart({
        registry,
        token: adminToken,
        slug,
        version: "1.0.0",
        changelog: "old payload publish by cli-admin without ownerHandle",
      });
      const userPublish = await publishSkillMultipart({
        registry,
        token: userToken,
        slug,
        version: "1.0.0",
        changelog: "old payload publish by cli-user without ownerHandle",
      });

      expect(typeof adminPublish.skillId).toBe("string");
      expect(typeof userPublish.skillId).toBe("string");
      expect(adminPublish.skillId).not.toBe(userPublish.skillId);

      const adminRead = await readScopedSkill(registry, slug, "cli-admin");
      expect(adminRead.skill?.slug).toBe(slug);
      expect(adminRead.owner?.handle).toBe("cli-admin");
      expect(adminRead.latestVersion?.version).toBe("1.0.0");

      const userRead = await readScopedSkill(registry, slug, "cli-user");
      expect(userRead.skill?.slug).toBe(slug);
      expect(userRead.owner?.handle).toBe("cli-user");
      expect(userRead.latestVersion?.version).toBe("1.0.0");

      await expectUnscopedSkillAmbiguous(registry, slug);
    },
    180_000,
  );

  itIfLocalRoleHelpMutations(
    "publishes the same skill slug under separate owner namespaces",
    async () => {
      const registry = getRegistry();
      const site = getSite();
      const { adminToken, userToken } = await resolveRoleHelpTokens(registry);
      const adminCfg = await makeTempConfig(registry, adminToken);
      const userCfg = await makeTempConfig(registry, userToken);
      const workdir = await mkdtemp(join(tmpdir(), "clawhub-e2e-owner-slug-"));
      const slug = `owner-scope-e2e-${Date.now()}`;
      const adminSkillDir = join(workdir, "admin-skill");
      const userSkillDir = join(workdir, "user-skill");

      async function expectScopedRead(ownerHandle: string) {
        const url = new URL(`${ApiRoutes.skills}/${encodeURIComponent(slug)}`, registry);
        url.searchParams.set("ownerHandle", ownerHandle);
        const response = await fetchWithTimeout(url.toString(), {
          headers: { Accept: "application/json" },
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          skill?: { slug?: unknown };
          owner?: { handle?: unknown };
        };
        expect(body.skill?.slug).toBe(slug);
        expect(body.owner?.handle).toBe(ownerHandle);
      }

      function publishSkill(params: { configPath: string; skillDir: string; changelog: string }) {
        return spawnSync(
          "bun",
          [
            "clawhub",
            "publish",
            params.skillDir,
            "--slug",
            slug,
            "--name",
            `Owner Scope ${slug}`,
            "--version",
            "1.0.0",
            "--tags",
            "latest",
            "--changelog",
            params.changelog,
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
              CLAWHUB_CONFIG_PATH: params.configPath,
              CLAWHUB_DISABLE_TELEMETRY: "1",
            },
            encoding: "utf8",
          },
        );
      }

      try {
        await mkdir(adminSkillDir, { recursive: true });
        await mkdir(userSkillDir, { recursive: true });
        await writeFile(join(adminSkillDir, "SKILL.md"), buildE2ESkillMarkdown(slug), "utf8");
        await writeFile(join(userSkillDir, "SKILL.md"), buildE2ESkillMarkdown(slug), "utf8");

        const adminPublish = publishSkill({
          configPath: adminCfg.path,
          skillDir: adminSkillDir,
          changelog: "manual owner-scope e2e first publish",
        });
        expect(adminPublish.status).toBe(0);

        const userPublish = publishSkill({
          configPath: userCfg.path,
          skillDir: userSkillDir,
          changelog: "manual owner-scope e2e second publish",
        });
        expect(userPublish.status).toBe(0);

        await expectScopedRead("cli-admin");
        await expectScopedRead("cli-user");

        const unscopedUrl = new URL(`${ApiRoutes.skills}/${encodeURIComponent(slug)}`, registry);
        const unscopedResponse = await fetchWithTimeout(unscopedUrl.toString(), {
          headers: { Accept: "text/plain" },
        });
        expect(unscopedResponse.status).toBe(409);
        const message = await unscopedResponse.text();
        expect(message).toContain("Ambiguous skill slug");
        expect(message).toContain(`/api/v1/skills/${slug}?ownerHandle=<owner>`);
      } finally {
        await rm(workdir, { recursive: true, force: true });
        await rm(adminCfg.dir, { recursive: true, force: true });
        await rm(userCfg.dir, { recursive: true, force: true });
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
