/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EndorContainerCleanupError,
  runEndorPluginScan,
  type EndorCommandDiagnostic,
} from "./run-endor-plugin-scan";

const containerId = "a".repeat(64);
const tempDirs: string[] = [];

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
id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
printf '%s %s\\n' "$1" "$2" >> "$root/docker-commands"
case "$2" in
  create)
    printf '%s\\n' "$@" > "$root/docker-create-args"
    printf '%s|%s|%s|%s|%s|%s|%s\\n' "$ENDOR_NAMESPACE" "$ENDOR_TOKEN" "$OPENAI_API_KEY" "$SECURITY_SCAN_WORKER_TOKEN" "$HOME" "$DOCKER_CONFIG" "$DOCKER_HOST" > "$root/docker-create-env"
    shift 2
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --name) printf '%s' "$2" > "$root/docker-name"; shift 2 ;;
        --label) printf '%s' "$2" > "$root/docker-label"; shift 2 ;;
        *) shift ;;
      esac
    done
    touch "$root/docker-exists"
    if [[ -f "$root/docker-create-sleep" ]]; then sleep 2; fi
    printf '%s\\n' "$id"
    ;;
  start)
    printf '%s|%s|%s|%s|%s|%s|%s\\n' "$ENDOR_NAMESPACE" "$ENDOR_TOKEN" "$OPENAI_API_KEY" "$SECURITY_SCAN_WORKER_TOKEN" "$HOME" "$DOCKER_CONFIG" "$DOCKER_HOST" > "$root/docker-start-env"
    if [[ -f "$root/docker-start-sleep" ]]; then sleep 2; fi
    if [[ -f "$root/docker-start-stdout" ]]; then cat "$root/docker-start-stdout"; fi
    if [[ -f "$root/docker-start-stderr" ]]; then cat "$root/docker-start-stderr" >&2; fi
    if [[ -f "$root/docker-start-exit" ]]; then exit "$(cat "$root/docker-start-exit")"; fi
    ;;
  inspect)
    printf '%s|%s|%s|%s|%s|%s|%s\\n' "$ENDOR_NAMESPACE" "$ENDOR_TOKEN" "$OPENAI_API_KEY" "$SECURITY_SCAN_WORKER_TOKEN" "$HOME" "$DOCKER_CONFIG" "$DOCKER_HOST" > "$root/docker-cleanup-env"
    if [[ -f "$root/docker-inspect-missing-once" ]]; then
      rm "$root/docker-inspect-missing-once"
      echo "Error: No such object" >&2
      exit 1
    fi
    if [[ ! -f "$root/docker-exists" ]]; then echo "Error: No such object" >&2; exit 1; fi
    name=$(cat "$root/docker-name")
    label=$(cat "$root/docker-label")
    run_id=\${label##*=}
    if [[ -f "$root/docker-inspect-id" ]]; then id=$(cat "$root/docker-inspect-id"); fi
    if [[ -f "$root/docker-inspect-name" ]]; then name=$(cat "$root/docker-inspect-name"); fi
    if [[ -f "$root/docker-inspect-label" ]]; then run_id=$(cat "$root/docker-inspect-label"); fi
    printf '%s\\n/%s\\n%s\\n' "$id" "$name" "$run_id"
    ;;
  rm)
    if [[ -f "$root/docker-rm-exit" ]]; then exit "$(cat "$root/docker-rm-exit")"; fi
    printf '%s' "$5" > "$root/docker-removed"
    rm "$root/docker-exists"
    ;;
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
  return JSON.stringify({
    all_findings: allFindings,
    blocking_findings: [],
    warning_findings: [],
  });
}

function runScan(
  workspace: string,
  extraEnv: NodeJS.ProcessEnv = {},
  onDiagnostic?: (diagnostic: Partial<EndorCommandDiagnostic>) => void,
) {
  return runEndorPluginScan({ workspace, env: env(workspace, extraEnv), onDiagnostic });
}

describe("runEndorPluginScan", () => {
  it.each(["plugin", "claw"] as const)(
    "scans a normalized disposable %s package and retains only exact reachable functions",
    async (family) => {
      const workspace = await tempDir();
      const root = await packageRoot(workspace);
      await writeFile(
        join(root, "package.json"),
        `${JSON.stringify({
          name: "fixture-plugin",
          ...(family === "claw" ? { openclaw: { claw: "CLAW.md" } } : {}),
          dependencies: { "runtime-workspace": "workspace:*", lodash: "4.17.20" },
          devDependencies: { "dev-workspace": "workspace:^", typescript: "6.0.3" },
        })}\n`,
      );
      await writeFile(join(root, "npm-shrinkwrap.json"), '{"lockfileVersion":3}\n');
      await writeFile(
        join(root, family === "plugin" ? "openclaw.plugin.json" : "CLAW.md"),
        family === "plugin" ? '{"id":"fixture-plugin"}\n' : "# Fixture Claw\n",
      );
      await writeFile(
        join(workspace, "docker-start-stdout"),
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
      );

      expect(result).toMatchObject({
        status: "completed",
        reachableFunctionCount: 1,
        findings: [{ severity: "high", summary: "Reachable lodash function is vulnerable" }],
      });
      expect(result.checkedAt).toBeGreaterThanOrEqual(before);
      expect(result.checkedAt).toBeLessThanOrEqual(Date.now());
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
      await expect(readFile(join(root, "npm-shrinkwrap.json"), "utf8")).resolves.toContain(
        '"lockfileVersion":3',
      );
      const createArgs = (await readFile(join(workspace, "docker-create-args"), "utf8"))
        .trim()
        .split("\n");
      expect(createArgs).toContain("bridge");
      expect(createArgs).toContain("NET_ADMIN");
      expect(createArgs).toContain("ALL");
      expect(createArgs).toContain("SETUID");
      expect(createArgs).toContain("SETGID");
      expect(createArgs).toContain("SETPCAP");
      expect(createArgs).toContain("CHOWN");
      expect(createArgs).toContain("no-new-privileges:true");
      expect(createArgs).toContain("--read-only");
      expect(createArgs).toContain("/usr/local/bin/clawhub-endor-entrypoint");
      expect(createArgs).toContain("clawhub-endor-scan");
      const runId = (await readFile(join(workspace, "docker-name"), "utf8")).replace(
        "clawhub-endor-",
        "",
      );
      expect(runId).toMatch(/^[a-f0-9]{32}$/);
      expect(createArgs).toContain(`clawhub-endor-${runId}`);
      expect(createArgs).toContain(`org.openclaw.clawhub.endor-run-id=${runId}`);
      expect(createArgs).toContain(
        `type=bind,source=${join(workspace, "endor-artifact")},target=/workspace,readonly`,
      );
      expect(createArgs.filter((arg) => arg === "--env")).toHaveLength(2);
      expect(createArgs).toContain("ENDOR_NAMESPACE");
      expect(createArgs).toContain("ENDOR_TOKEN");
      expect(createArgs).not.toContain("fixture-token");
      expect(createArgs).not.toContain("OPENAI_API_KEY");
      expect(await readFile(join(workspace, "docker-create-env"), "utf8")).toBe(
        "fixture-namespace|fixture-token|||/tmp/fixture-home|/tmp/fixture-docker-config|\n",
      );
      expect(await readFile(join(workspace, "docker-start-env"), "utf8")).toBe(
        "||||/tmp/fixture-home|/tmp/fixture-docker-config|\n",
      );
      expect(await readFile(join(workspace, "docker-cleanup-env"), "utf8")).toBe(
        "||||/tmp/fixture-home|/tmp/fixture-docker-config|\n",
      );
      expect(
        (await readFile(join(workspace, "docker-commands"), "utf8")).trim().split("\n"),
      ).toEqual(["container create", "container start", "container inspect", "container rm"]);
      expect(await readFile(join(workspace, "docker-removed"), "utf8")).toBe(containerId);
      expect(Object.assign({}, ...diagnostics)).toMatchObject({ exitCode: 0 });
      expect(JSON.stringify(diagnostics)).not.toContain("fixture-token");
    },
  );

  it("returns an explicit skip when package.json is missing", async () => {
    const workspace = await tempDir();
    await mkdir(join(workspace, "artifact"));
    await expect(runScan(workspace)).resolves.toMatchObject({
      status: "skipped",
      reason: "Endor requires package.json at the package artifact root.",
    });
    await expect(readFile(join(workspace, "docker-commands"))).rejects.toThrow();
  });

  it("bounds the summary without losing the total reachable-function count", async () => {
    const workspace = await tempDir();
    await packageRoot(workspace);
    await writeFile(
      join(workspace, "docker-start-stdout"),
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

  it.each([
    "",
    "not json",
    "{}",
    '{"all_findings":[]}',
    '{"all_findings":[{}],"blocking_findings":[],"warning_findings":[]}',
  ])("fails closed on missing or invalid Endor output: %j", async (raw) => {
    const workspace = await tempDir();
    await packageRoot(workspace);
    await writeFile(join(workspace, "docker-start-stdout"), raw);
    await expect(runScan(workspace)).rejects.toThrow(
      "Endor scanner did not emit valid findings JSON",
    );
    expect(await readFile(join(workspace, "docker-removed"), "utf8")).toBe(containerId);
  });

  it("reports a nonzero container exit with redacted diagnostics", async () => {
    const workspace = await tempDir();
    await packageRoot(workspace);
    await writeFile(join(workspace, "docker-start-stdout"), '{"detail":"fixture-token"}');
    await writeFile(join(workspace, "docker-start-stderr"), "ENDOR_TOKEN=fixture-token\n");
    await writeFile(join(workspace, "docker-start-exit"), "17");
    const diagnostics: Array<Partial<EndorCommandDiagnostic>> = [];
    await expect(
      runScan(workspace, { ENDOR_TOKEN: "fixture-token" }, (next) => diagnostics.push(next)),
    ).rejects.toThrow("Endor Docker start exited 17");
    expect(Object.assign({}, ...diagnostics)).toMatchObject({
      exitCode: 17,
      stderr: "ENDOR_TOKEN=[redacted-secret]\n",
      stdout: '{"detail":"[redacted-secret]"}',
      timedOut: false,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("fixture-token");
    expect(await readFile(join(workspace, "docker-removed"), "utf8")).toBe(containerId);
  });

  it("stops and removes an owned container after a scan timeout", async () => {
    const workspace = await tempDir();
    await packageRoot(workspace);
    await writeFile(join(workspace, "docker-start-sleep"), "");
    const diagnostics: Array<Partial<EndorCommandDiagnostic>> = [];
    await expect(
      runScan(workspace, { CODEX_SECURITY_SCAN_ENDOR_TIMEOUT_MS: "1000" }, (next) =>
        diagnostics.push(next),
      ),
    ).rejects.toThrow("Endor Docker start timed out");
    expect(Object.assign({}, ...diagnostics)).toMatchObject({ timedOut: true });
    expect(await readFile(join(workspace, "docker-removed"), "utf8")).toBe(containerId);
  });

  it("finds a container that becomes visible after Docker create times out", async () => {
    const workspace = await tempDir();
    await packageRoot(workspace);
    await writeFile(join(workspace, "docker-create-sleep"), "");
    await writeFile(join(workspace, "docker-inspect-missing-once"), "");
    await expect(
      runScan(workspace, { CODEX_SECURITY_SCAN_ENDOR_TIMEOUT_MS: "1000" }),
    ).rejects.toThrow("Endor Docker create timed out");
    expect(await readFile(join(workspace, "docker-removed"), "utf8")).toBe(containerId);
    expect(
      (await readFile(join(workspace, "docker-commands"), "utf8")).match(/container inspect/g),
    ).toHaveLength(2);
  });

  it.each([
    ["docker-inspect-label", "another-run"],
    ["docker-inspect-id", "--force"],
    ["docker-inspect-name", "another-container"],
  ])("refuses cleanup when %s does not identify the owned container", async (file, value) => {
    const workspace = await tempDir();
    await packageRoot(workspace);
    await writeFile(join(workspace, "docker-start-stdout"), report());
    await writeFile(join(workspace, file), value);
    await expect(runScan(workspace)).rejects.toThrow("ownership does not match");
    await expect(readFile(join(workspace, "docker-removed"))).rejects.toThrow();
  });

  it("reports cleanup failure after success and alongside scan failure", async () => {
    for (const failScan of [false, true]) {
      const workspace = await tempDir();
      await packageRoot(workspace);
      await writeFile(join(workspace, "docker-start-stdout"), report());
      await writeFile(join(workspace, "docker-rm-exit"), "23");
      if (failScan) await writeFile(join(workspace, "docker-start-exit"), "17");
      const error = await runScan(workspace).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(EndorContainerCleanupError);
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining(
          failScan
            ? "Endor scan failed: Endor Docker start exited 17;"
            : "Endor Docker cleanup failed",
        ),
      );
    }
  });

  it("rejects an external artifact symlink before invoking Docker", async () => {
    const workspace = await tempDir();
    const root = await packageRoot(workspace);
    const external = join(await tempDir(), "outside.js");
    await writeFile(external, "export const outside = true;\n");
    await symlink(external, join(root, "outside.js"));
    await expect(runScan(workspace)).rejects.toThrow(
      "Package artifact contains a symlink outside its root",
    );
    await expect(readFile(join(workspace, "docker-commands"))).rejects.toThrow();
  });
});
