/* @vitest-environment node */

import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const distDir = join(packageRoot, "dist");
const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("packed admin CLI", () => {
  it("builds and runs from a tarball when dist is missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "clawhub-admin-artifact-"));
    tempDirs.push(tempDir);
    const packDir = join(tempDir, "pack");
    const installDir = join(tempDir, "install");
    await mkdir(packDir);
    await mkdir(installDir);
    await symlink(join(repoRoot, "node_modules"), join(installDir, "node_modules"), "dir");
    await rm(distDir, { recursive: true, force: true });

    const output = execFileSync("npm", ["pack", "--json", "--pack-destination", packDir], {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: join(tempDir, "npm-cache"),
        npm_config_ignore_scripts: "false",
      },
    });
    const metadata = JSON.parse(output) as
      | Array<{ filename?: string }>
      | Record<string, { filename?: string }>;
    const filename = Array.isArray(metadata)
      ? metadata[0]?.filename
      : Object.values(metadata)[0]?.filename;
    expect(filename).toBeTruthy();

    const tarballPath = join(packDir, filename!);
    execFileSync("tar", ["-xzf", tarballPath, "-C", installDir]);

    const result = spawnSync(
      process.execPath,
      [join(installDir, "package", "bin", "clawhub-admin.js"), "--help"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0" },
      },
    );
    expect(result.status).toBe(0);
    const jobIdsFile = join(tempDir, "job-ids.json");
    const jobIds = ["v5700000000000000000000000000000", "v5710000000000000000000000000000"];
    await writeFile(jobIdsFile, JSON.stringify(jobIds));
    const plan = spawnSync(
      process.execPath,
      [
        join(installDir, "package", "bin", "clawhub-admin.js"),
        "skills",
        "plan-scan-workers",
        jobIdsFile,
        "--batch-limit",
        "32",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(plan.status).toBe(0);
    const { inputs, deferredJobIds } = JSON.parse(plan.stdout);
    expect(deferredJobIds).toEqual([]);
    expect(inputs["batch-limit"]).toBe("32");
    expect(JSON.parse(inputs["assigned-jobs"]).flat()).toEqual(jobIds);

    expect(result.stdout).toContain("Usage: clawhub-admin");
    expect(result.stdout.replace(/\s+/g, " ")).toContain(
      "registry discovery and device verification",
    );
    for (const command of [["login"], ["auth", "login"]]) {
      const loginHelp = spawnSync(
        process.execPath,
        [join(installDir, "package", "bin", "clawhub-admin.js"), ...command, "--help"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: { ...process.env, FORCE_COLOR: "0" },
        },
      );
      const help = loginHelp.stdout.replace(/\s+/g, " ");
      expect(loginHelp.status).toBe(0);
      expect(help).toContain("Log in with device flow or store a token");
      expect(help).toContain("Token label (device flow only)");
      expect(help).toContain("Admin CLI token");
      expect(help).toContain("verification URL without opening a browser");
      expect(help).not.toMatch(/opens browser|requires --token|--device/);
    }
    const packagesHelp = spawnSync(
      process.execPath,
      [join(installDir, "package", "bin", "clawhub-admin.js"), "packages", "--help"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0" },
      },
    );
    expect(packagesHelp.status).toBe(0);
    expect(packagesHelp.stdout).toContain("validation-report");
    expect(packagesHelp.stdout).toContain("Export current plugin validation results as JSON");
    const authFailure = spawnSync(
      process.execPath,
      [
        join(installDir, "package", "bin", "clawhub-admin.js"),
        "--registry",
        "https://example.invalid",
        "packages",
        "validation-report",
        "--json",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          CLAWHUB_CONFIG_PATH: join(tempDir, "missing-auth.json"),
          FORCE_COLOR: "0",
        },
      },
    );
    expect(authFailure.status).not.toBe(0);
    expect(authFailure.stdout).toBe("");
    expect(authFailure.stderr).toMatch(/not logged in|login/i);

    const requests: Array<{
      method: string | undefined;
      url: string | undefined;
      authorization: string | undefined;
      body: unknown;
    }> = [];
    const trustedPublisher = {
      provider: "github-actions",
      repository: "openclaw/example",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
      workflowFilename: "publish.yml",
    };
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body) as { environment?: string };
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: parsed,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ trustedPublisher: { ...trustedPublisher, ...parsed } }));
    });
    try {
      await new Promise<void>((resolveListening) =>
        server.listen(0, "127.0.0.1", resolveListening),
      );
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const registry = `http://127.0.0.1:${address.port}`;
      const configPath = join(tempDir, "trusted-publisher-auth.json");
      await writeFile(configPath, JSON.stringify({ registry, token: "artifact-test-token" }));
      const setArgs = [
        join(installDir, "package", "bin", "clawhub-admin.js"),
        "--registry",
        registry,
        "packages",
        "trusted-publisher",
        "set",
        " @openclaw/example ",
        "--repository",
        " openclaw/example ",
        "--workflow-filename",
        " publish.yml ",
      ];
      const run = (args: string[], config = configPath) =>
        execFileAsync(process.execPath, args, {
          cwd: tempDir,
          env: { ...process.env, CLAWHUB_CONFIG_PATH: config, FORCE_COLOR: "0" },
        });
      const json = await run([...setArgs, "--environment", " release ", "--json"]);
      expect(JSON.parse(json.stdout)).toEqual({
        trustedPublisher: { ...trustedPublisher, environment: "release" },
      });
      const text = await run(setArgs);
      expect(text.stdout).toContain("Trusted publisher saved for @openclaw/example.");
      expect(text.stdout).toContain("Provider: github-actions");
      expect(text.stdout).toContain("Repository: openclaw/example");
      expect(text.stdout).toContain("Workflow: publish.yml");
      expect(text.stdout).not.toContain("Environment:");
      await expect(
        run([...setArgs, "--json"], join(tempDir, "missing-auth.json")),
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringMatching(/not logged in|login/i),
      });
      expect(requests).toEqual([
        {
          method: "POST",
          url: "/api/v1/packages/%40openclaw%2Fexample/trusted-publisher",
          authorization: "Bearer artifact-test-token",
          body: {
            repository: "openclaw/example",
            workflowFilename: "publish.yml",
            environment: "release",
          },
        },
        {
          method: "POST",
          url: "/api/v1/packages/%40openclaw%2Fexample/trusted-publisher",
          authorization: "Bearer artifact-test-token",
          body: { repository: "openclaw/example", workflowFilename: "publish.yml" },
        },
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClosed, reject) =>
        server.close((error) => (error ? reject(error) : resolveClosed())),
      );
    }
    await expect(
      readFile(join(installDir, "package", "dist", "clawhub-admin", "src", "cli.js")),
    ).resolves.toBeTruthy();
  });
});
