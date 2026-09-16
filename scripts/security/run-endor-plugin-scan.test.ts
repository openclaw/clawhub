/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runEndorPluginScan, type EndorCommandDiagnostic } from "./run-endor-plugin-scan";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function tempDir() {
  const directory = await mkdtemp(join(tmpdir(), "clawhub-endor-plugin-test-"));
  tempDirs.push(directory);
  return directory;
}

async function writeFakeClawScan(path: string, body: string) {
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
}

describe("runEndorPluginScan", () => {
  it("scans a normalized disposable package copy and retains only exact reachable functions in the summary", async () => {
    const workspace = await tempDir();
    const packageRoot = join(workspace, "artifact", "package");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "fixture-plugin",
        dependencies: { "runtime-workspace": "workspace:*", lodash: "4.17.20" },
        devDependencies: { "dev-workspace": "workspace:^", typescript: "6.0.3" },
      })}\n`,
    );
    await writeFile(join(packageRoot, "npm-shrinkwrap.json"), '{"lockfileVersion":3}\n');
    await writeFile(join(packageRoot, "SKILL.md"), "# Bundled skill\n");
    await writeFile(join(packageRoot, "openclaw.plugin.json"), '{"id":"fixture-plugin"}\n');

    const command = join(workspace, "fake-clawscan");
    const argsLog = join(workspace, "args.log");
    const envLog = join(workspace, "env.log");
    await writeFakeClawScan(
      command,
      `printf '%s\\n' "$@" > ${JSON.stringify(argsLog)}
printf '%s\\n' "\${ENDOR_NAMESPACE-}" "\${ENDOR_TOKEN-}" "\${OPENAI_API_KEY-}" "\${SECURITY_SCAN_WORKER_TOKEN-}" "\${HOME-}" "\${DOCKER_CONFIG-}" "\${DOCKER_HOST-}" > ${JSON.stringify(envLog)}
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then output="$2"; shift 2; else shift; fi
done
cat > "$output" <<'JSON'
{
  "completedAt": "2026-09-15T00:00:00Z",
  "scanners": {
    "endor": {
      "status": "completed",
      "raw": {
        "all_findings": [
          {
            "uuid": "exact",
            "meta": {"name": "exact finding"},
            "spec": {
              "extra_key": "GHSA-exact",
              "finding_tags": ["FINDING_TAGS_REACHABLE_FUNCTION"],
              "level": "FINDING_LEVEL_HIGH",
              "summary": "Reachable lodash function is vulnerable",
              "target_dependency_package_name": "npm://lodash@4.17.20",
              "target_dependency_version": "4.17.20"
            }
          },
          {
            "uuid": "potential",
            "spec": {
              "extra_key": "GHSA-potential",
              "finding_tags": ["FINDING_TAGS_POTENTIALLY_REACHABLE_FUNCTION"],
              "level": "FINDING_LEVEL_CRITICAL"
            }
          },
          {
            "uuid": "dependency",
            "spec": {
              "extra_key": "GHSA-dependency",
              "finding_tags": ["FINDING_TAGS_REACHABLE_DEPENDENCY"],
              "level": "FINDING_LEVEL_MEDIUM"
            }
          }
        ],
        "blocking_findings": [{"uuid": "exact"}],
        "warning_findings": [{"uuid": "potential"}]
      }
    }
  }
}
JSON`,
    );

    const result = await runEndorPluginScan({
      workspace,
      env: {
        CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND: command,
        CODEX_SECURITY_SCAN_ENDOR_IMAGE: "clawscan-endor:test",
        DOCKER_CONFIG: "/tmp/fixture-docker-config",
        DOCKER_HOST: "must-not-reach-endor",
        ENDOR_NAMESPACE: "fixture-namespace",
        ENDOR_TOKEN: "fixture-token",
        HOME: "/tmp/fixture-home",
        OPENAI_API_KEY: "must-not-reach-endor",
        PATH: process.env.PATH,
        SECURITY_SCAN_WORKER_TOKEN: "must-not-reach-endor",
      },
    });

    expect(result.analysis).toEqual({
      status: "completed",
      checkedAt: Date.parse("2026-09-15T00:00:00Z"),
      reachableFunctionCount: 1,
      findings: [{ severity: "high", summary: "Reachable lodash function is vulnerable" }],
    });
    expect(result.scannerReport).toMatchObject({
      status: "completed",
      all_findings: [{ uuid: "exact" }, { uuid: "potential" }, { uuid: "dependency" }],
      blocking_findings: [{ uuid: "exact" }],
      warning_findings: [{ uuid: "potential" }],
      preparation: {
        sourceRoot: "artifact/package",
        normalizations: [
          {
            dependencyNames: ["dev-workspace"],
            kind: "omit-workspace-development-dependencies",
            packageRoot: ".",
          },
          { kind: "npm-shrinkwrap-rename", packageRoot: "." },
        ],
      },
    });
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
    await expect(readFile(join(packageRoot, "npm-shrinkwrap.json"), "utf8")).resolves.toContain(
      '"lockfileVersion":3',
    );
    expect((await readFile(argsLog, "utf8")).trim().split("\n")).toEqual([
      "./endor-artifact/openclaw.plugin.json",
      "--scanner",
      "endor",
      "--sandbox",
      "docker",
      "--sandbox-image",
      "clawscan-endor:test",
      "--output",
      join(workspace, "endor-clawscan-artifact.json"),
    ]);
    expect((await readFile(envLog, "utf8")).split("\n")).toEqual([
      "fixture-namespace",
      "fixture-token",
      "",
      "",
      "/tmp/fixture-home",
      "/tmp/fixture-docker-config",
      "",
      "",
    ]);
  });

  it("returns an explicit skipped result when the package artifact has no package.json", async () => {
    const workspace = await tempDir();
    await mkdir(join(workspace, "artifact"), { recursive: true });

    await expect(runEndorPluginScan({ workspace, env: {} })).resolves.toMatchObject({
      analysis: {
        status: "skipped",
        reason: "Endor requires package.json at the package artifact root.",
      },
      scannerReport: {
        status: "skipped",
        preparation: { normalizations: [] },
      },
    });
  });

  it("preserves a failed scanner artifact cause with configured secrets redacted", async () => {
    const workspace = await tempDir();
    const packageRoot = join(workspace, "artifact", "package");
    const command = join(workspace, "fake-clawscan");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), '{"name":"fixture"}\n');
    await writeFakeClawScan(
      command,
      `output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then output="$2"; shift 2; else shift; fi
done
cat > "$output" <<'JSON'
{"completedAt":"2026-09-16T00:00:00Z","scanners":{"endor":{"status":"failed","error":"Dependency resolution failed with ENDOR_TOKEN=fixture-token and fixture-token"}}}
JSON`,
    );
    const diagnostics: Array<Partial<EndorCommandDiagnostic>> = [];

    await expect(
      runEndorPluginScan({
        workspace,
        env: {
          CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND: command,
          CODEX_SECURITY_SCAN_ENDOR_IMAGE: "clawscan-endor:test",
          ENDOR_NAMESPACE: "fixture-namespace",
          ENDOR_TOKEN: "fixture-token",
          PATH: process.env.PATH,
        },
        onDiagnostic: (next) => diagnostics.push(next),
      }),
    ).rejects.toThrow(
      "Endor ClawScan scanner status was failed: Dependency resolution failed with ENDOR_TOKEN=[redacted-secret] and [redacted-secret]",
    );

    expect(Object.assign({}, ...diagnostics)).toMatchObject({
      exitCode: 0,
      scannerError:
        "Dependency resolution failed with ENDOR_TOKEN=[redacted-secret] and [redacted-secret]",
    });
    expect(JSON.stringify(diagnostics)).not.toContain("fixture-token");
  });

  it.each([
    { name: "exit", body: 'echo "ENDOR_TOKEN=fixture-token" >&2\nexit 17', timedOut: false },
    {
      name: "timeout",
      body: 'echo "ENDOR_TOKEN=fixture-token" >&2\nsleep 2',
      timedOut: true,
    },
  ])("preserves redacted command diagnostics on $name", async ({ body, timedOut }) => {
    const workspace = await tempDir();
    const packageRoot = join(workspace, "artifact", "package");
    const command = join(workspace, "fake-clawscan");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), '{"name":"fixture"}\n');
    await writeFakeClawScan(command, body);
    const diagnostics: Array<Partial<EndorCommandDiagnostic>> = [];

    await expect(
      runEndorPluginScan({
        workspace,
        env: {
          CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND: command,
          CODEX_SECURITY_SCAN_ENDOR_IMAGE: "clawscan-endor:test",
          CODEX_SECURITY_SCAN_ENDOR_TIMEOUT_MS: timedOut ? "1000" : undefined,
          ENDOR_NAMESPACE: "fixture-namespace",
          ENDOR_TOKEN: "fixture-token",
          PATH: process.env.PATH,
        },
        onDiagnostic: (next) => diagnostics.push(next),
      }),
    ).rejects.toThrow(timedOut ? "Endor ClawScan timed out" : "Endor ClawScan exited 17");

    expect(Object.assign({}, ...diagnostics)).toMatchObject({
      stderr: "ENDOR_TOKEN=[redacted-secret]\n",
      timedOut,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("fixture-token");
  });

  it("rejects an external artifact symlink before invoking ClawScan", async () => {
    const workspace = await tempDir();
    const packageRoot = join(workspace, "artifact", "package");
    const external = join(await tempDir(), "outside.js");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), '{"name":"fixture"}\n');
    await writeFile(external, "export const outside = true;\n");
    await symlink(external, join(packageRoot, "outside.js"));

    await expect(
      runEndorPluginScan({
        workspace,
        env: {
          CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND: join(workspace, "missing-clawscan"),
          CODEX_SECURITY_SCAN_ENDOR_IMAGE: "clawscan-endor:test",
          ENDOR_NAMESPACE: "fixture-namespace",
          ENDOR_TOKEN: "fixture-token",
        },
      }),
    ).rejects.toThrow("Package artifact contains a symlink outside its root");
  });
});
