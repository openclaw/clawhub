/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const binPath = join(packageRoot, "bin", "clawdhub.js");
const distCliPath = join(packageRoot, "dist", "cli.js");

const tempDirs: string[] = [];

async function makeTmpDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runNode(args: string[]) {
  return spawnSync("node", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
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
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("built CLI artifact", () => {
  it("runs help from the published bin entrypoint", async () => {
    const result = runNode([binPath, "--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("ClawHub CLI");
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
