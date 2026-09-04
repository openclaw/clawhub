/* @vitest-environment node */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const distDir = join(packageRoot, "dist");
const tempDirs: string[] = [];

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
    await expect(
      readFile(join(installDir, "package", "dist", "clawhub-admin", "src", "cli.js")),
    ).resolves.toBeTruthy();
  });
});
