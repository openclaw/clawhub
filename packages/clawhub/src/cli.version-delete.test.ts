/* @vitest-environment node */

import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function runCliSync(args: string[]) {
  return spawnSync("bun", ["src/cli.ts", ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn("bun", ["src/cli.ts", ...args], {
      cwd: packageRoot,
      env: { ...process.env, ...env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr, stdout }));
  });
}

describe("version delete CLI registration", () => {
  it("documents reversible version withdrawal and restore", () => {
    const skillDelete = runCliSync(["delete", "--help"]);
    const skillUndelete = runCliSync(["undelete", "--help"]);
    const packageDelete = runCliSync(["package", "delete", "--help"]);
    const packageUndelete = runCliSync(["package", "undelete", "--help"]);

    for (const result of [skillDelete, packageDelete]) {
      const help = result.stdout.replace(/\s+/g, " ");
      expect(result.status).toBe(0);
      expect(help).toContain("--version <version>");
      expect(help).toContain("retained artifact can be restored");
      expect(help).toContain("version number remains reserved");
    }
    for (const result of [skillUndelete, packageUndelete]) {
      const help = result.stdout.replace(/\s+/g, " ");
      expect(result.status).toBe(0);
      expect(help).toContain("--version <version>");
      expect(help).toContain("exact retained");
      expect(help).toContain("without changing latest");
    }
  });

  it("forwards skill and package version delete and restore requests", async () => {
    const requests: Array<{ body: unknown; method: string | undefined; url: string | undefined }> =
      [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bodyText = Buffer.concat(chunks).toString("utf8");
      requests.push({
        body: bodyText ? JSON.parse(bodyText) : undefined,
        method: request.method,
        url: request.url,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const registry = `http://127.0.0.1:${address.port}`;
    const tempDir = await mkdtemp(join(tmpdir(), "clawhub-cli-version-delete-"));
    tempDirs.push(tempDir);
    const configPath = join(tempDir, "config.json");
    await writeFile(configPath, JSON.stringify({ registry, token: "clh_test" }));

    try {
      const env = { CLAWHUB_CONFIG_PATH: configPath };
      const skillResult = await runCli(
        ["--registry", registry, "--no-input", "delete", "demo", "--version", "1.2.3", "--yes"],
        env,
      );
      const packageResult = await runCli(
        [
          "--registry",
          registry,
          "--no-input",
          "package",
          "delete",
          "@openclaw/demo",
          "--version",
          "2.3.4",
          "--yes",
          "--json",
        ],
        env,
      );
      const skillRestoreResult = await runCli(
        ["--registry", registry, "--no-input", "undelete", "demo", "--version", "1.2.3", "--yes"],
        env,
      );
      const packageRestoreResult = await runCli(
        [
          "--registry",
          registry,
          "--no-input",
          "package",
          "undelete",
          "@openclaw/demo",
          "--version",
          "2.3.4",
          "--yes",
          "--json",
        ],
        env,
      );

      expect(skillResult).toMatchObject({ code: 0 });
      expect(packageResult).toMatchObject({ code: 0 });
      expect(skillRestoreResult).toMatchObject({ code: 0 });
      expect(packageRestoreResult).toMatchObject({ code: 0 });
      expect(requests).toEqual([
        {
          method: "DELETE",
          url: "/api/v1/skills/demo/versions/1.2.3",
          body: { version: "1.2.3" },
        },
        {
          method: "DELETE",
          url: "/api/v1/packages/%40openclaw%2Fdemo/versions/2.3.4",
          body: { version: "2.3.4" },
        },
        {
          method: "POST",
          url: "/api/v1/skills/demo/versions/1.2.3/restore",
          body: { version: "1.2.3" },
        },
        {
          method: "POST",
          url: "/api/v1/packages/%40openclaw%2Fdemo/versions/2.3.4/restore",
          body: {},
        },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
