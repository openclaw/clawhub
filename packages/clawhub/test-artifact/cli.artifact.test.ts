/* @vitest-environment node */

import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const binPath = join(packageRoot, "bin", "clawdhub.js");
const distCliPath = join(packageRoot, "dist", "cli.js");

const tempDirs: string[] = [];
const servers: Server[] = [];

async function makeTmpDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runNode(args: string[], envOverrides: NodeJS.ProcessEnv = {}) {
  const { FORCE_COLOR: _forceColor, ...env } = process.env;
  return spawnSync("node", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...env, ...envOverrides },
  });
}

async function runNodeAsync(args: string[], envOverrides: NodeJS.ProcessEnv = {}) {
  const { FORCE_COLOR: _forceColor, ...env } = process.env;
  const child = spawn("node", args, {
    cwd: repoRoot,
    env: { ...env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const timeout = setTimeout(() => child.kill("SIGTERM"), 20_000);
  const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit, rejectExit) => {
      child.on("error", rejectExit);
      child.on("exit", (status, signal) => resolveExit({ status, signal }));
    },
  );
  clearTimeout(timeout);
  return { ...result, stdout, stderr };
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

afterEach(async () => {
  while (servers.length > 0) {
    await new Promise<void>((resolveClose, rejectClose) => {
      const server = servers.pop()!;
      server.closeAllConnections();
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

type RecordedRequest = {
  method: string;
  path: string;
  authorization?: string;
  body?: unknown;
};

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function startLocalRegistry() {
  const requests: RecordedRequest[] = [];
  const skillZip = zipSync({
    "SKILL.md": strToU8("# Demo\n\nA local registry fixture.\n"),
  });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const bodyText = await readRequestBody(request);
    const recorded: RecordedRequest = {
      method: request.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      authorization: request.headers.authorization,
    };
    if (bodyText) recorded.body = JSON.parse(bodyText) as unknown;
    requests.push(recorded);

    if (request.method === "GET" && url.pathname === "/api/v1/whoami") {
      writeJson(response, 200, {
        user: { handle: "artifact-user", displayName: "Artifact User", role: "user" },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/skills/demo") {
      writeJson(response, 200, {
        skill: {
          slug: "demo",
          displayName: "Demo",
          summary: "Local fixture",
          tags: {},
          stats: {},
          createdAt: 1,
          updatedAt: 2,
        },
        latestVersion: {
          version: "1.0.0",
          createdAt: 2,
          changelog: "Initial",
          license: "MIT-0",
        },
        owner: null,
        moderation: {
          isSuspicious: false,
          isMalwareBlocked: false,
          verdict: "clean",
          reasonCodes: [],
          updatedAt: null,
          engineVersion: null,
          summary: null,
        },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/skills/demo/versions/1.0.0") {
      writeJson(response, 200, {
        version: {
          version: "1.0.0",
          createdAt: 2,
          changelog: "Initial",
          changelogSource: "user",
          license: "MIT-0",
          files: [],
        },
        skill: {
          slug: "demo",
          displayName: "Demo",
        },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/download") {
      expect(url.searchParams.get("slug")).toBe("demo");
      expect(url.searchParams.get("version")).toBe("1.0.0");
      response.writeHead(200, { "Content-Type": "application/zip" });
      response.end(Buffer.from(skillZip));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/resolve") {
      writeJson(response, 200, {
        match: { version: "1.0.0" },
        latestVersion: { version: "1.0.0" },
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cli/telemetry/install") {
      writeJson(response, 200, { ok: true });
      return;
    }

    writeJson(response, 404, { error: `Unhandled ${request.method} ${url.pathname}` });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  servers.push(server);

  const address = server.address() as AddressInfo;
  return {
    registry: `http://127.0.0.1:${address.port}`,
    requests,
  };
}

async function writeConfigWithToken(root: string, registry: string) {
  const configPath = join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ registry, token: "test-token" }), "utf8");
  return configPath;
}

describe("built CLI artifact", () => {
  it("runs help from the published bin entrypoint", async () => {
    const result = runNode([binPath, "--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("ClawHub CLI");
  });

  it("prints help by default", async () => {
    const result = runNode([binPath]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: clawhub");
    expect(result.stdout).toContain("sync");
  });

  it("runs sync for bare logged-in invocations", async () => {
    const { registry, requests } = await startLocalRegistry();
    const workdir = await makeTmpDir("clawhub-artifact-bare-sync-");
    const configPath = await writeConfigWithToken(workdir, registry);
    const skillDir = join(workdir, "skills", "demo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Demo\n\nA local sync fixture.\n", "utf8");

    const result = await runNodeAsync(
      [binPath, "--workdir", workdir, "--registry", registry, "--no-input"],
      { CLAWHUB_CONFIG_PATH: configPath },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Usage: clawhub");
    expect(requests.map((request) => request.path)).toContain("/api/v1/whoami");
    expect(requests.map((request) => request.path)).toContainEqual(
      expect.stringMatching(/^\/api\/v1\/resolve\?slug=demo&hash=/),
    );
  });

  it("exposes sync help for reusable publishing workflows", async () => {
    const result = runNode([binPath, "sync", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: clawhub sync");
    expect(result.stdout).toContain("Scan local skills and publish new/updated ones");
  });

  it("reports unknown top-level commands clearly", async () => {
    const result = runNode([binPath, "nope"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error: unknown command 'nope'");
    expect(result.stderr).not.toContain("too many arguments");
  });

  it("reports unknown top-level commands after global options", async () => {
    const result = runNode([binPath, "--registry", "https://clawhub.ai", "nope"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error: unknown command 'nope'");
    expect(result.stderr).not.toContain("too many arguments");
  });

  it("rejects invalid sync bump values before scanning", async () => {
    const workdir = await makeTmpDir("clawhub-artifact-invalid-bump-");
    const result = runNode([
      binPath,
      "--workdir",
      workdir,
      "sync",
      "--bump",
      "banana",
      "--dry-run",
      "--no-clawdbot-roots",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--bump must be patch, minor, or major");
    expect(result.stderr).not.toContain("No skills found");
  });

  it("does not mask unknown global options", async () => {
    const result = runNode([binPath, "--bad", "nope"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error: unknown option '--bad'");
    expect(result.stderr).not.toContain("unknown command 'nope'");
  });

  it("keeps help and version flags terminal", async () => {
    const helpResult = runNode([binPath, "nope", "--help"]);
    const versionResult = runNode([binPath, "--cli-version", "nope"]);

    expect(helpResult.status).toBe(0);
    expect(helpResult.stderr).toBe("");
    expect(helpResult.stdout).toContain("ClawHub CLI");
    expect(versionResult.status).toBe(0);
    expect(versionResult.stderr).toBe("");
    expect(versionResult.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("publishes a local code plugin in dry-run json mode from built output", async () => {
    const root = await makeTmpDir("clawhub-artifact-");
    const pluginDir = join(root, "demo-plugin");
    await mkdir(join(pluginDir, "src"), { recursive: true });
    await writeFile(
      join(pluginDir, "package.json"),
      JSON.stringify({
        name: "@openclaw/demo-plugin",
        displayName: "Demo Plugin",
        version: "1.0.0",
        openclaw: {
          compat: {
            pluginApi: ">=2026.3.24-beta.2",
            minGatewayVersion: "2026.3.24-beta.2",
          },
          build: {
            openclawVersion: "2026.3.24-beta.2",
            pluginSdkVersion: "2026.3.24-beta.2",
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(pluginDir, "openclaw.plugin.json"),
      JSON.stringify({
        id: "demo.plugin",
        configSchema: {
          type: "object",
          additionalProperties: false,
        },
      }),
      "utf8",
    );
    await writeFile(join(pluginDir, "src", "index.ts"), "export const demo = true;\n", "utf8");

    runGit(root, ["init"]);
    runGit(root, ["remote", "add", "origin", "https://github.com/openclaw/demo-plugin.git"]);
    runGit(root, ["add", "."]);
    runGit(root, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "init",
    ]);

    const result = runNode([
      binPath,
      "package",
      "publish",
      pluginDir,
      "--dry-run",
      "--json",
      "--registry",
      "https://clawhub.ai",
      "--site",
      "https://clawhub.ai",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(output.name).toBe("@openclaw/demo-plugin");
    expect(output.family).toBe("code-plugin");
    expect(output.version).toBe("1.0.0");
    expect(output.commit).toBeTypeOf("string");
  });

  it("sends one explicit install telemetry event from the built install command", async () => {
    const { registry, requests } = await startLocalRegistry();
    const workdir = await makeTmpDir("clawhub-artifact-install-");
    const configPath = await writeConfigWithToken(workdir, registry);

    const result = await runNodeAsync(
      [
        binPath,
        "--workdir",
        workdir,
        "--registry",
        registry,
        "install",
        "demo",
        "--version",
        "1.0.0",
      ],
      { CLAWHUB_CONFIG_PATH: configPath },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("OK. Installed demo");

    const telemetryRequests = requests.filter(
      (request) => request.path === "/api/cli/telemetry/install",
    );
    expect(telemetryRequests).toHaveLength(1);
    expect(telemetryRequests[0]).toEqual({
      method: "POST",
      path: "/api/cli/telemetry/install",
      authorization: "Bearer test-token",
      body: {
        event: "install",
        slug: "demo",
        version: "1.0.0",
        rootId: expect.any(String),
        rootLabel: expect.stringContaining("skills"),
      },
    });

    expect(requests.map((request) => request.path)).toEqual([
      "/api/v1/skills/demo",
      "/api/v1/skills/demo/versions/1.0.0",
      "/api/v1/download?slug=demo&version=1.0.0",
      "/api/cli/telemetry/install",
    ]);
  });

  it("does not send install telemetry from the built sync command", async () => {
    const { registry, requests } = await startLocalRegistry();
    const workdir = await makeTmpDir("clawhub-artifact-sync-");
    const configPath = await writeConfigWithToken(workdir, registry);
    const skillDir = join(workdir, "skills", "demo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Demo\n\nA local sync fixture.\n", "utf8");

    const result = await runNodeAsync(
      [
        binPath,
        "--workdir",
        workdir,
        "--registry",
        registry,
        "sync",
        "--dry-run",
        "--json",
        "--no-clawdbot-roots",
      ],
      { CLAWHUB_CONFIG_PATH: configPath },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout.trim()) as { ok: boolean; dryRun: boolean };
    expect(output).toMatchObject({ ok: true, dryRun: true });

    expect(
      requests.filter((request) => request.path.startsWith("/api/cli/telemetry/")),
    ).toHaveLength(0);
    expect(requests.map((request) => request.path)).toEqual([
      "/api/v1/whoami",
      expect.stringMatching(/^\/api\/v1\/resolve\?slug=demo&hash=/),
    ]);
  });

  it("keeps the built dist free of compiled test files", async () => {
    expect(dirname(distCliPath)).toBe(join(packageRoot, "dist"));
    const result = runNode([
      "--input-type=module",
      "--eval",
      `import { readdir } from 'node:fs/promises';
       import { join } from 'node:path';
       const queue = ['${join(packageRoot, "dist").replaceAll("\\", "\\\\")}'];
       const hits = [];
       while (queue.length > 0) {
         const dir = queue.pop();
         for (const entry of await readdir(dir, { withFileTypes: true })) {
           const path = join(dir, entry.name);
           if (entry.isDirectory()) queue.push(path);
           else if (entry.name.includes('.test.')) hits.push(path);
         }
       }
       if (hits.length > 0) {
         console.error(hits.join('\\n'));
         process.exit(1);
       }`,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
