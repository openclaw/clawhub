/* @vitest-environment node */
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, unknown>;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

function expectSecretStepAllowlist(
  steps: WorkflowStep[],
  secretName: string,
  allowedStepNames: string[],
) {
  for (const step of steps) {
    const stepName = step.name ?? step.uses ?? "<unnamed>";
    const hasSecret =
      Object.hasOwn(step.env ?? {}, secretName) ||
      JSON.stringify(step).includes(`secrets.${secretName}`);
    expect(hasSecret, `${secretName} on ${stepName}`).toBe(allowedStepNames.includes(stepName));
  }
}

describe("skill-card-worker workflow", () => {
  it.each(["0.164.0", "0.160.0"])(
    "selects or rejects installed Codex %s despite an earlier ambient CLI",
    async (installedVersion) => {
      const workflow = parseYaml(await readFile(".github/workflows/skill-card-worker.yml", "utf8"));
      const step = workflow.jobs["skill-card-worker"].steps.find((entry: WorkflowStep) =>
        entry.name?.startsWith("Install Codex CLI"),
      );
      let command = step?.run;
      if (step?.uses?.startsWith("./")) {
        const action = parseYaml(await readFile(join(step.uses, "action.yml"), "utf8"));
        expect(action.runs.steps[0]).toMatchObject({
          uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
          with: { "node-version": "24.22.1" },
        });
        command = action.runs.steps.find((entry: WorkflowStep) => entry.run)?.run;
      }
      if (!command) throw new Error("Missing worker dependency installation command");
      const root = await mkdtemp(join(tmpdir(), "skill-card-runtime-"));
      try {
        const ambient = join(root, "ambient");
        const runnerTemp = join(root, "runner-temp");
        const githubPath = join(root, "github-path");
        await mkdir(ambient);
        await mkdir(runnerTemp);
        await writeFile(githubPath, "");
        const commands = {
          codex: '#!/bin/sh\nprintf "%s\\n" "codex-cli ambient-old"\n',
          python3: "#!/bin/sh\nexit 0\n",
          npm: [
            "#!/bin/sh",
            "set -eu",
            'prefix="$npm_config_prefix"',
            'package=""',
            "global=false",
            'while [ "$#" -gt 0 ]; do',
            '  case "$1" in',
            "    install) shift;;",
            "    -g|--global) global=true; shift;;",
            '    @openai/codex@0.164.0) package="$1"; shift;;',
            '    --prefix) prefix="$2"; shift 2;;',
            "    *) exit 1;;",
            "  esac",
            "done",
            'test "$global" = true && test "$package" = @openai/codex@0.164.0',
            'mkdir -p "$prefix/bin"',
            "printf '%s\\n' '#!/bin/sh' \"printf '%s\\\\n' 'codex-cli $WORKFLOW_TEST_CODEX_VERSION'\" > \"$prefix/bin/codex\"",
            'chmod 755 "$prefix/bin/codex"',
          ].join("\n"),
        };
        for (const [name, content] of Object.entries(commands)) {
          await writeFile(join(ambient, name), content);
          await chmod(join(ambient, name), 0o755);
        }
        const env = {
          PATH: ambient + ":/usr/bin:/bin",
          RUNNER_TEMP: runnerTemp,
          GITHUB_PATH: githubPath,
          npm_config_prefix: join(root, "npm-global"),
          WORKFLOW_TEST_CODEX_VERSION: installedVersion,
        };
        if (installedVersion !== "0.164.0") {
          await expect(promisify(execFile)("bash", ["-e", "-c", command], { env })).rejects.toThrow(
            "Expected codex-cli 0.164.0 after installation; got codex-cli 0.160.0",
          );
          expect(await readFile(githubPath, "utf8")).toBe("");
          return;
        }
        await promisify(execFile)("bash", ["-e", "-c", command], { env });
        const addedPaths = (await readFile(githubPath, "utf8")).trim().split("\n").filter(Boolean);
        const result = await promisify(execFile)("codex", ["--version"], {
          env: { ...env, PATH: [...addedPaths.reverse(), env.PATH].join(":") },
        });
        expect(result.stdout.trim()).toBe("codex-cli 0.164.0");
        expect(
          (await promisify(execFile)(join(ambient, "codex"), ["--version"])).stdout.trim(),
        ).toBe("codex-cli ambient-old");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("isolates fixture dispatch from queue draining and backend credentials", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/skill-card-worker.yml", "utf8"));
    expect(workflow.on.workflow_dispatch.inputs["fixture-only"]).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(workflow.jobs["skill-card-worker"].if).toBe(
      "${{ github.event_name != 'workflow_dispatch' || inputs.fixture-only != true }}",
    );
    const fixture = workflow.jobs.fixture;
    expect(fixture.if).toBe(
      "${{ github.event_name == 'workflow_dispatch' && inputs.fixture-only == true }}",
    );
    expect(fixture.environment).toBe("Production");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(fixture.env).toBeUndefined();
    expectSecretStepAllowlist(fixture.steps, "OPENAI_API_KEY", ["Authenticate Codex CLI"]);
    expectSecretStepAllowlist(fixture.steps, "SECURITY_SCAN_WORKER_TOKEN", []);
    expectSecretStepAllowlist(fixture.steps, "CONVEX_DEPLOY_KEY", []);
    expect(JSON.stringify(fixture)).not.toMatch(
      /CONVEX_URL|VITE_CONVEX_URL|upload-artifact|run-skill-card-worker/,
    );
    expect(
      fixture.steps.find((step: WorkflowStep) => step.name === "Install Codex CLI")?.uses,
    ).toBe("./.github/actions/setup-codex");
    expect(fixture.steps.at(-1).run).toBe("bun scripts/skill-cards/credential-canary.ts");
  });

  it("does not expose OPENAI_API_KEY to the artifact-processing worker step", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/skill-card-worker.yml", "utf8"),
    ) as {
      jobs: {
        "skill-card-worker": {
          env?: Record<string, unknown>;
          "timeout-minutes"?: number;
          strategy?: { matrix?: { shard?: number[] } };
          steps: WorkflowStep[];
        };
      };
      concurrency?: unknown;
      on?: {
        workflow_dispatch?: {
          inputs?: Record<string, { default?: string }>;
        };
      };
    };
    const job = workflow.jobs["skill-card-worker"];

    expect(workflow.on?.workflow_dispatch?.inputs?.["batch-limit"]?.default).toBe("4");
    expect(workflow.on?.workflow_dispatch?.inputs?.["max-runtime-minutes"]?.default).toBe("40");
    expect(workflow.concurrency).toBeUndefined();
    expect(job["timeout-minutes"]).toBe(60);
    expect(job.strategy?.matrix?.shard).toEqual([0, 1, 2, 3]);
    expect(job.env?.CONVEX_URL).toBe(
      "${{ vars.CONVEX_URL || vars.VITE_CONVEX_URL || 'https://wry-manatee-359.convex.cloud' }}",
    );
    expect(job.env?.SKILL_CARD_WORKER_LIMIT).toBe(
      "${{ github.event.inputs['batch-limit'] || '4' }}",
    );
    expect(job.env?.SKILL_CARD_WORKER_MAX_RUNTIME_MINUTES).toBe(
      "${{ github.event.inputs['max-runtime-minutes'] || '40' }}",
    );
    expect(job.env?.SKILL_CARD_WORKER_LEASE_MINUTES).toBe("60");
    expect(job.env?.SKILL_CARD_WORKER_SHARD).toBe("${{ matrix.shard }}");
    expect(job.env?.SKILL_CARD_WORKER_ID).toBe(
      "github-actions:${{ github.run_id }}:${{ github.run_attempt }}:${{ matrix.shard }}",
    );
    expect(job.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(job.env).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    const checkConfiguration = job.steps.find((step) => step.name === "Check configuration");
    expect(checkConfiguration?.run).toContain('if [[ -z "$CONVEX_URL" ]]');
    expect(checkConfiguration?.run).toContain("exit 1");
    expectSecretStepAllowlist(job.steps, "OPENAI_API_KEY", ["Authenticate Codex CLI"]);
    expectSecretStepAllowlist(job.steps, "SECURITY_SCAN_WORKER_TOKEN", ["Run Skill Card worker"]);
    expect(job.steps.find((step) => step.name === "Authenticate Codex CLI")?.env).toHaveProperty(
      "OPENAI_API_KEY",
    );
    expect(
      job.steps.find((step) => step.name === "Run Skill Card worker")?.env ?? {},
    ).not.toHaveProperty("OPENAI_API_KEY");
    expect(job.steps.find((step) => step.name === "Run Skill Card worker")?.env).toHaveProperty(
      "SECURITY_SCAN_WORKER_TOKEN",
    );
    expect(job.steps.find((step) => step.name === "Install Codex CLI")?.uses).toBe(
      "./.github/actions/setup-codex",
    );
    const dependenciesInstall = job.steps.find(
      (step) => step.name === "Install renderer dependencies",
    )?.run;
    expect(dependenciesInstall).toContain(
      "python3 -m pip install --user --retries 5 --timeout 60 'jinja2==3.1.6'",
    );
    expect(dependenciesInstall).not.toContain("@latest");
    expect(dependenciesInstall).not.toMatch(/pip install --user jinja2(?:\s|$)/);
  });
});
