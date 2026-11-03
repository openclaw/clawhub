/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runEndorPluginScan, type EndorCommandDiagnostic } from "./run-endor-plugin-scan";

const tempDirs: string[] = [];
const claimedRelease = {
  package: { name: "@openclaw/fixture-plugin" },
  release: { version: "1.0.0" },
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function tempDir() {
  const workspace = await mkdtemp(join(tmpdir(), "clawhub-endor-plugin-test-"));
  tempDirs.push(workspace);
  const bin = join(workspace, "bin");
  await mkdir(bin);
  const docker = join(bin, "docker");
  await writeFile(
    docker,
    `#!/usr/bin/env bash
set -eo pipefail
root=$PWD
case "$1" in
  run)
    printf '%s\\n' "$@" > "$root/docker-run-args"
    printf '%s|%s|%s|%s|%s|%s|%s\\n' "$ENDOR_NAMESPACE" "$ENDOR_TOKEN" "$OPENAI_API_KEY" "$SECURITY_SCAN_WORKER_TOKEN" "$HOME" "$DOCKER_CONFIG" "$DOCKER_HOST" > "$root/docker-run-env"
    if [[ -f "$root/docker-run-sleep" ]]; then sleep 2; fi
    if [[ -f "$root/docker-run-stdout" ]]; then cat "$root/docker-run-stdout"; fi
    if [[ -f "$root/docker-run-stderr" ]]; then cat "$root/docker-run-stderr" >&2; fi
    if [[ -f "$root/docker-run-exit" ]]; then exit "$(cat "$root/docker-run-exit")"; fi
    ;;
  rm) printf '%s\\n' "$@" > "$root/docker-rm-args" ;;
  *) echo "unexpected docker command: $*" >&2; exit 99 ;;
esac
`,
  );
  await chmod(docker, 0o755);
  return workspace;
}

function env(workspace: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CODEX_SECURITY_SCAN_ENDOR_IMAGE: "clawscan-endor:test",
    PATH: `${join(workspace, "bin")}:${process.env.PATH ?? ""}`,
    ...extra,
  };
}

async function packageRoot(workspace: string) {
  const root = join(workspace, "artifact", "package");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"fixture"}\n');
  return root;
}

function report(allFindings: unknown[] = []) {
  return JSON.stringify({ all_findings: allFindings });
}

function runScan(
  workspace: string,
  extraEnv: NodeJS.ProcessEnv = {},
  onDiagnostic?: (diagnostic: Partial<EndorCommandDiagnostic>) => void,
  packageRelease: Parameters<typeof runEndorPluginScan>[0]["packageRelease"] = claimedRelease,
) {
  return runEndorPluginScan({
    workspace,
    env: env(workspace, extraEnv),
    onDiagnostic,
    packageRelease,
  });
}

async function dockerRunArgs(workspace: string) {
  return (await readFile(join(workspace, "docker-run-args"), "utf8")).trim().split("\n");
}

describe("runEndorPluginScan", () => {
  it("scans a normalized disposable package and retains only exact reachable functions", async () => {
    const workspace = await tempDir();
    const root = await packageRoot(workspace);
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({
        name: "fixture-plugin",
        dependencies: { "runtime-workspace": "workspace:*", lodash: "4.17.20" },
        devDependencies: { "dev-workspace": "workspace:^", typescript: "6.0.3" },
      })}\n`,
    );
    await writeFile(join(root, "npm-shrinkwrap.json"), '{"lockfileVersion":3}\n');
    await writeFile(
      join(workspace, "docker-run-stdout"),
      report([
        {
          spec: {
            finding_tags: ["FINDING_TAGS_REACHABLE_FUNCTION"],
            level: "FINDING_LEVEL_HIGH",
            summary: "Reachable lodash function is vulnerable",
          },
        },
        { spec: { finding_tags: ["FINDING_TAGS_POTENTIALLY_REACHABLE_FUNCTION"] } },
        { spec: { finding_tags: ["FINDING_TAGS_REACHABLE_DEPENDENCY"] } },
      ]),
    );
    const diagnostics: Array<Partial<EndorCommandDiagnostic>> = [];
    const before = Date.now();
    const result = await runScan(
      workspace,
      {
        DOCKER_CONFIG: "/tmp/fixture-docker-config",
        DOCKER_HOST: "must-not-reach-endor",
        ENDOR_NAMESPACE: "fixture-namespace",
        ENDOR_TOKEN: "fixture-token",
        HOME: "/tmp/fixture-home",
        OPENAI_API_KEY: "must-not-reach-endor",
        SECURITY_SCAN_WORKER_TOKEN: "must-not-reach-endor",
      },
      (next) => diagnostics.push(next),
      {
        package: { name: "@openclaw/claimed-bundle" },
        release: { version: "2026-10,stable" },
      },
    );

    expect(result).toMatchObject({
      status: "completed",
      reachableFunctionCount: 1,
      findings: [{ severity: "high", summary: "Reachable lodash function is vulnerable" }],
    });
    expect(result.checkedAt).toBeGreaterThanOrEqual(before);
    expect(
      JSON.parse(await readFile(join(workspace, "endor-artifact", "package.json"), "utf8")),
    ).toEqual({
      name: "fixture-plugin",
      dependencies: { "runtime-workspace": "workspace:*", lodash: "4.17.20" },
      devDependencies: { typescript: "6.0.3" },
    });
    await expect(
      readFile(join(workspace, "endor-artifact", "package-lock.json"), "utf8"),
    ).resolves.toContain('"lockfileVersion":3');
    // The uploaded artifact stays untouched.
    await expect(readFile(join(root, "npm-shrinkwrap.json"), "utf8")).resolves.toContain(
      '"lockfileVersion":3',
    );
    const runArgs = await dockerRunArgs(workspace);
    expect(runArgs).toContain("--rm");
    expect(runArgs).toContain(
      `type=bind,source=${join(workspace, "endor-artifact")},target=/workspace,readonly`,
    );
    expect(runArgs.slice(-2)).toEqual([
      "https://clawhub.ai/api/v1/packages/%40openclaw/claimed-bundle/versions/2026-10%2Cstable/artifact/download",
      "plugin:@openclaw/claimed-bundle,version:2026-10%2Cstable",
    ]);
    // Only Endor credentials and the Docker CLI context reach Docker.
    expect(await readFile(join(workspace, "docker-run-env"), "utf8")).toBe(
      "fixture-namespace|fixture-token|||/tmp/fixture-home|/tmp/fixture-docker-config|\n",
    );
    await expect(readFile(join(workspace, "docker-rm-args"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(Object.assign({}, ...diagnostics)).toMatchObject({ exitCode: 0 });
    expect(JSON.stringify(diagnostics)).not.toContain("fixture-token");
  });

  it("bounds the summary without losing the total reachable-function count", async () => {
    const workspace = await tempDir();
    await packageRoot(workspace);
    await writeFile(
      join(workspace, "docker-run-stdout"),
      report(
        Array.from({ length: 52 }, (_, index) => ({
          spec: {
            finding_tags: ["FINDING_TAGS_REACHABLE_FUNCTION"],
            summary: `${index}-${"x".repeat(2_100)}`,
          },
        })),
      ),
    );
    const result = await runScan(workspace);
    expect(result).toMatchObject({ status: "completed", reachableFunctionCount: 52 });
    if (result.status !== "completed") throw new Error("expected completed Endor analysis");
    expect(result.findings).toHaveLength(50);
    expect(result.findings[0]?.summary).toHaveLength(2_000);
  });

  it("reports a nonzero scanner exit with redacted diagnostics and removes the container", async () => {
    const workspace = await tempDir();
    await packageRoot(workspace);
    await writeFile(join(workspace, "docker-run-stdout"), '{"detail":"fixture-token"}');
    await writeFile(join(workspace, "docker-run-stderr"), "ENDOR_TOKEN=fixture-token\n");
    await writeFile(join(workspace, "docker-run-exit"), "17");
    const diagnostics: Array<Partial<EndorCommandDiagnostic>> = [];
    await expect(
      runScan(workspace, { ENDOR_TOKEN: "fixture-token" }, (next) => diagnostics.push(next)),
    ).rejects.toThrow("Endor scan exited 17");
    expect(Object.assign({}, ...diagnostics)).toMatchObject({
      exitCode: 17,
      stderr: "ENDOR_TOKEN=[redacted-secret]\n",
      stdout: '{"detail":"[redacted-secret]"}',
      timedOut: false,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("fixture-token");
    const containerName = (await dockerRunArgs(workspace))[3];
    expect(containerName).toMatch(/^clawhub-endor-/);
    expect((await readFile(join(workspace, "docker-rm-args"), "utf8")).trim().split("\n")).toEqual([
      "rm",
      "--force",
      containerName,
    ]);
  });

  it("removes the still-running container when the scan times out", async () => {
    const workspace = await tempDir();
    await packageRoot(workspace);
    await writeFile(join(workspace, "docker-run-sleep"), "");
    const diagnostics: Array<Partial<EndorCommandDiagnostic>> = [];
    await expect(
      runScan(workspace, { CODEX_SECURITY_SCAN_ENDOR_TIMEOUT_MS: "500" }, (next) =>
        diagnostics.push(next),
      ),
    ).rejects.toMatchObject({ timedOut: true });
    const containerName = diagnostics[0]?.args?.[4];
    expect(containerName).toMatch(/^clawhub-endor-/);
    expect((await readFile(join(workspace, "docker-rm-args"), "utf8")).trim().split("\n")).toEqual([
      "rm",
      "--force",
      containerName,
    ]);
  });

  it("skips artifacts without a package manifest instead of reporting a clean scan", async () => {
    const workspace = await tempDir();
    await mkdir(join(workspace, "artifact"), { recursive: true });
    await expect(runScan(workspace)).resolves.toMatchObject({
      status: "skipped",
      reason: "Endor requires package.json at the package artifact root.",
    });
    await expect(readFile(join(workspace, "docker-run-args"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
