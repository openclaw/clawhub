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
  await writeFakeDocker(directory);
  return directory;
}

async function writeFakeClawScan(path: string, body: string) {
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
}

async function writeFakeDocker(
  workspace: string,
  body = `if [[ "$1" == "container" && "$2" == "ls" ]]; then exit 0; fi
echo "unexpected docker command: $*" >&2
exit 99`,
) {
  const binDirectory = join(workspace, "bin");
  const path = join(binDirectory, "docker");
  await mkdir(binDirectory, { recursive: true });
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

function testPath(workspace: string) {
  return `${join(workspace, "bin")}:${process.env.PATH ?? ""}`;
}

describe("runEndorPluginScan", () => {
  it.each(["plugin", "claw"] as const)(
    "scans a normalized disposable %s package and retains only exact reachable functions",
    async (family) => {
      const workspace = await tempDir();
      const packageRoot = join(workspace, "artifact", "package");
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        join(packageRoot, "package.json"),
        `${JSON.stringify({
          name: "fixture-plugin",
          ...(family === "claw" ? { openclaw: { claw: "CLAW.md" } } : {}),
          dependencies: { "runtime-workspace": "workspace:*", lodash: "4.17.20" },
          devDependencies: { "dev-workspace": "workspace:^", typescript: "6.0.3" },
        })}\n`,
      );
      await writeFile(join(packageRoot, "npm-shrinkwrap.json"), '{"lockfileVersion":3}\n');
      if (family === "plugin") {
        await writeFile(join(packageRoot, "SKILL.md"), "# Bundled skill\n");
        await writeFile(join(packageRoot, "openclaw.plugin.json"), '{"id":"fixture-plugin"}\n');
      } else {
        await writeFile(
          join(packageRoot, "CLAW.md"),
          "---\nschemaVersion: 1\nagent:\n  id: fixture-plugin\n---\n# Fixture Claw\n",
        );
      }

      const command = join(workspace, "fake-clawscan");
      const argsLog = join(workspace, "args.log");
      const envLog = join(workspace, "env.log");
      await writeFakeClawScan(
        command,
        `printf '%s\\n' "$@" > ${JSON.stringify(argsLog)}
printf '%s\\n' "\${ENDOR_NAMESPACE-}" "\${ENDOR_TOKEN-}" "\${OPENAI_API_KEY-}" "\${SECURITY_SCAN_WORKER_TOKEN-}" "\${HOME-}" "\${DOCKER_CONFIG-}" "\${DOCKER_HOST-}" "\${CLAWSCAN_SANDBOX_RUN_ID-}" > ${JSON.stringify(envLog)}
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
          PATH: testPath(workspace),
          SECURITY_SCAN_WORKER_TOKEN: "must-not-reach-endor",
        },
      });

      expect(result).toEqual({
        status: "completed",
        checkedAt: Date.parse("2026-09-15T00:00:00Z"),
        reachableFunctionCount: 1,
        findings: [{ severity: "high", summary: "Reachable lodash function is vulnerable" }],
      });
      expect(
        JSON.parse(await readFile(join(workspace, "endor-artifact", "package.json"), "utf8")),
      ).toEqual({
        name: "fixture-plugin",
        ...(family === "claw" ? { openclaw: { claw: "CLAW.md" } } : {}),
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
        family === "plugin" ? "./endor-artifact/openclaw.plugin.json" : "./endor-artifact",
        "--config",
        join(workspace, "endor-clawscan.json"),
        "--profile",
        "endor",
        "--sandbox",
        "docker",
        "--sandbox-image",
        "clawscan-endor:test",
        "--output",
        join(workspace, "endor-clawscan-artifact.json"),
      ]);
      const commandEnv = (await readFile(envLog, "utf8")).trim().split("\n");
      expect(commandEnv.slice(0, 7)).toEqual([
        "fixture-namespace",
        "fixture-token",
        "",
        "",
        "/tmp/fixture-home",
        "/tmp/fixture-docker-config",
        "",
      ]);
      expect(commandEnv[7]).toMatch(/^[a-f0-9]{32}$/);
      const config = await readFile(join(workspace, "endor-clawscan.json"), "utf8");
      expect(JSON.parse(config)).toEqual({
        version: 1,
        profiles: {
          endor: {
            scanners: [
              {
                id: "endor",
                command: "clawhub-endor-scan {{target}}",
                targets: ["skill", "plugin"],
                env: ["ENDOR_NAMESPACE"],
                secretEnv: ["ENDOR_TOKEN"],
              },
            ],
          },
        },
      });
      expect(config).not.toContain("fixture-token");
    },
  );

  it("returns an explicit skipped result when the package artifact has no package.json", async () => {
    const workspace = await tempDir();
    await mkdir(join(workspace, "artifact"), { recursive: true });

    await expect(runEndorPluginScan({ workspace, env: {} })).resolves.toMatchObject({
      status: "skipped",
      reason: "Endor requires package.json at the package artifact root.",
    });
  });

  it("bounds the summary without losing the total reachable-function count", async () => {
    const workspace = await tempDir();
    const packageRoot = join(workspace, "artifact", "package");
    const command = join(workspace, "fake-clawscan");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), '{"name":"fixture"}\n');
    const allFindings = Array.from({ length: 52 }, (_, index) => ({
      spec: {
        finding_tags: ["FINDING_TAGS_REACHABLE_FUNCTION"],
        level: "FINDING_LEVEL_HIGH",
        summary: `${index}-${"x".repeat(2_100)}`,
      },
    }));
    await writeFakeClawScan(
      command,
      `output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then output="$2"; shift 2; else shift; fi
done
cat > "$output" <<'JSON'
${JSON.stringify({
  completedAt: "2026-09-16T00:00:00Z",
  scanners: {
    endor: {
      status: "completed",
      raw: { all_findings: allFindings, blocking_findings: [], warning_findings: [] },
    },
  },
})}
JSON`,
    );

    const result = await runEndorPluginScan({
      workspace,
      env: {
        CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND: command,
        CODEX_SECURITY_SCAN_ENDOR_IMAGE: "clawscan-endor:test",
        PATH: testPath(workspace),
      },
    });

    expect(result).toMatchObject({ status: "completed", reachableFunctionCount: 52 });
    if (result.status !== "completed") throw new Error("expected a completed Endor analysis");
    expect(result.findings).toHaveLength(50);
    expect(result.findings[0]?.summary).toHaveLength(2_000);
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
{"completedAt":"2026-09-16T00:00:00Z","scanners":{"endor":{"status":"failed","raw":null,"error":"Dependency resolution failed with ENDOR_TOKEN=fixture-token and fixture-token"}}}
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
          PATH: testPath(workspace),
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
    {
      name: "exit",
      body: 'echo "ENDOR_TOKEN=fixture-token" >&2\nexit 17',
      stderr: "ENDOR_TOKEN=[redacted-secret]\n",
      timedOut: false,
    },
    {
      name: "timeout",
      body: "sleep 2",
      stderr: "",
      timedOut: true,
    },
  ])("preserves redacted command diagnostics on $name", async ({ body, stderr, timedOut }) => {
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
          PATH: testPath(workspace),
        },
        onDiagnostic: (next) => diagnostics.push(next),
      }),
    ).rejects.toThrow(timedOut ? "Endor ClawScan timed out" : "Endor ClawScan exited 17");

    expect(Object.assign({}, ...diagnostics)).toMatchObject({
      stderr,
      timedOut,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("fixture-token");
  });

  it("removes an owned late-created container after the parent timeout", async () => {
    const workspace = await tempDir();
    const packageRoot = join(workspace, "artifact", "package");
    const command = join(workspace, "fake-clawscan");
    const runIdPath = join(workspace, "run-id.txt");
    const listCountPath = join(workspace, "list-count.txt");
    const removedPath = join(workspace, "removed.txt");
    const cleanupEnvPath = join(workspace, "cleanup-env.log");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), '{"name":"fixture"}\n');
    await writeFakeClawScan(command, "sleep 5");
    await writeFakeDocker(
      workspace,
      `printf '%s\\n' "\${ENDOR_NAMESPACE-}|\${ENDOR_TOKEN-}|\${ENDOR_API_CREDENTIALS_KEY-}|\${ENDOR_API_CREDENTIALS_SECRET-}|\${HOME-}|\${DOCKER_CONFIG-}" >> ${JSON.stringify(cleanupEnvPath)}
case "$2" in
  ls)
    printf '%s' "\${6##*=}" > ${JSON.stringify(runIdPath)}
    count=0
    if [[ -f ${JSON.stringify(listCountPath)} ]]; then count=$(cat ${JSON.stringify(listCountPath)}); fi
    count=$((count + 1))
    printf '%s' "$count" > ${JSON.stringify(listCountPath)}
    if (( count >= 2 )) && [[ ! -f ${JSON.stringify(removedPath)} ]]; then printf '%s\\n' 0123456789ab; fi
    ;;
  inspect)
    printf '%s\\n%s\\n' "$(cat ${JSON.stringify(runIdPath)})" command123
    ;;
  rm)
    printf '%s' "$5" > ${JSON.stringify(removedPath)}
    ;;
  *) exit 99 ;;
esac`,
    );

    const failure = await runEndorPluginScan({
      workspace,
      env: {
        CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND: command,
        CODEX_SECURITY_SCAN_ENDOR_IMAGE: "clawscan-endor:test",
        CODEX_SECURITY_SCAN_ENDOR_TIMEOUT_MS: "500",
        DOCKER_CONFIG: "/tmp/fixture-docker-config",
        ENDOR_API_CREDENTIALS_KEY: "fixture-key",
        ENDOR_API_CREDENTIALS_SECRET: "fixture-secret",
        ENDOR_NAMESPACE: "fixture-namespace",
        ENDOR_TOKEN: "fixture-token",
        HOME: "/tmp/fixture-home",
        PATH: testPath(workspace),
      },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error("expected Endor timeout failure");
    expect(failure.message).toContain("Endor ClawScan timed out");
    expect(failure.message).not.toContain("Docker cleanup failed");

    expect(await readFile(removedPath, "utf8")).toBe("0123456789ab");
    const cleanupEnvironments = (await readFile(cleanupEnvPath, "utf8")).trim().split("\n");
    expect(cleanupEnvironments.length).toBeGreaterThan(2);
    expect(new Set(cleanupEnvironments)).toEqual(
      new Set(["||||/tmp/fixture-home|/tmp/fixture-docker-config"]),
    );
  });

  it("reports cleanup failure after command success and alongside command failure", async () => {
    const tests = [
      {
        name: "after success",
        body: `output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then output="$2"; shift 2; else shift; fi
done
cat > "$output" <<'JSON'
{"completedAt":"2026-09-16T00:00:00Z","scanners":{"endor":{"status":"completed","raw":{"all_findings":[],"blocking_findings":[],"warning_findings":[]}}}}
JSON`,
        expected: "Endor ClawScan Docker cleanup failed",
      },
      {
        name: "with command failure",
        body: "exit 17",
        expected:
          "Endor ClawScan failed: Endor ClawScan exited 17; see redacted stdout/stderr diagnostics; Docker cleanup failed",
      },
    ];
    for (const test of tests) {
      const workspace = await tempDir();
      const packageRoot = join(workspace, "artifact", "package");
      const command = join(workspace, "fake-clawscan");
      await mkdir(packageRoot, { recursive: true });
      await writeFile(join(packageRoot, "package.json"), '{"name":"fixture"}\n');
      await writeFakeClawScan(command, test.body);
      await writeFakeDocker(workspace, "exit 23");

      await expect(
        runEndorPluginScan({
          workspace,
          env: {
            CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND: command,
            CODEX_SECURITY_SCAN_ENDOR_IMAGE: "clawscan-endor:test",
            ENDOR_NAMESPACE: "fixture-namespace",
            ENDOR_TOKEN: "fixture-token",
            PATH: testPath(workspace),
          },
        }),
        test.name,
      ).rejects.toThrow(test.expected);
    }
  });

  it("accepts auto-remove races and rejects malformed container IDs", async () => {
    const tests = [
      {
        name: "missing during inspect",
        docker: () => `case "$2" in
  ls) printf '%s\\n' 0123456789ab ;;
  inspect) echo 'Error: No such object: 0123456789ab' >&2; exit 1 ;;
  *) exit 99 ;;
esac`,
      },
      {
        name: "missing during removal",
        docker: (runIdPath: string) => `case "$2" in
  ls) printf '%s\\n' 0123456789ab ;;
  inspect) printf '%s\\n%s\\n' "$(cat ${JSON.stringify(runIdPath)})" command123 ;;
  rm) echo 'Error: No such container: 0123456789ab' >&2; exit 1 ;;
  *) exit 99 ;;
esac`,
      },
      {
        name: "malformed ID",
        docker: () => `if [[ "$2" == "ls" ]]; then printf '%s\\n' --force; else exit 99; fi`,
        expected: "refusing invalid Docker container ID",
      },
    ];
    for (const test of tests) {
      const workspace = await tempDir();
      const packageRoot = join(workspace, "artifact", "package");
      const command = join(workspace, "fake-clawscan");
      const runIdPath = join(workspace, "run-id.txt");
      await mkdir(packageRoot, { recursive: true });
      await writeFile(join(packageRoot, "package.json"), '{"name":"fixture"}\n');
      await writeFakeClawScan(
        command,
        `printf '%s' "$CLAWSCAN_SANDBOX_RUN_ID" > ${JSON.stringify(runIdPath)}
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then output="$2"; shift 2; else shift; fi
done
cat > "$output" <<'JSON'
{"completedAt":"2026-09-16T00:00:00Z","scanners":{"endor":{"status":"completed","raw":{"all_findings":[],"blocking_findings":[],"warning_findings":[]}}}}
JSON`,
      );
      await writeFakeDocker(workspace, test.docker(runIdPath));

      const promise = runEndorPluginScan({
        workspace,
        env: {
          CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND: command,
          CODEX_SECURITY_SCAN_ENDOR_IMAGE: "clawscan-endor:test",
          ENDOR_NAMESPACE: "fixture-namespace",
          ENDOR_TOKEN: "fixture-token",
          PATH: testPath(workspace),
        },
      });
      if (test.expected) await expect(promise, test.name).rejects.toThrow(test.expected);
      else
        await expect(promise, test.name).resolves.toMatchObject({
          status: "completed",
          reachableFunctionCount: 0,
          findings: [],
        });
    }
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
