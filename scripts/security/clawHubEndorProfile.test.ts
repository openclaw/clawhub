/* @vitest-environment node */
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClawHubEndorProfile } from "./clawHubEndorProfile";
import { isEndorPluginScanEnabled } from "./run-endor-plugin-scan";

const execFileAsync = promisify(execFile);
afterEach(() => vi.unstubAllEnvs());

describe("disabled Endor profile judge", () => {
  it.each([false, true])(
    "executes its configured model, reasoning and Standard tier safely (override=%s)",
    async (override) => {
      const workspace = await mkdtemp(join(tmpdir(), "clawhub-endor-model-"));
      try {
        vi.stubEnv("CODEX_SECURITY_SCAN_ENDOR_ENABLED", undefined);
        vi.stubEnv("OPENAI_EVAL_MODEL", override ? "custom'judge" : undefined);
        vi.stubEnv("OPENAI_EVAL_REASONING_EFFORT", override ? "medium" : undefined);
        vi.stubEnv("OPENAI_EVAL_SERVICE_TIER", undefined);
        const schema = join(workspace, "schema.json");
        await writeFile(schema, "{}");
        const configPath = await writeClawHubEndorProfile(workspace, schema);
        const config = JSON.parse(await readFile(configPath, "utf8"));
        const profile = config.profiles.clawhub;
        expect(isEndorPluginScanEnabled("synthetic-model-policy-proof")).toBe(false);
        expect(profile.sandbox.env).toEqual(
          expect.arrayContaining([
            "DEFAULT_MODEL",
            "REASONING_EFFORT",
            "SKILLSPECTOR_MODEL",
            "SKILLSPECTOR_REASONING_EFFORT",
          ]),
        );
        expect(profile.sandbox.env).not.toContain("SECURITY_SCAN_WORKER_TOKEN");
        expect(profile.scanners.at(-1).command).toBe("false {{target}}");
        const fakeCodex = join(workspace, "codex");
        const argsPath = join(workspace, "args.json");
        await writeFile(
          fakeCodex,
          "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.ARGS_PATH, JSON.stringify(process.argv.slice(2)))\n",
        );
        await chmod(fakeCodex, 0o755);
        const command = profile.judge.command
          .replaceAll("{{ workspace }}", JSON.stringify(workspace))
          .replaceAll("{{ judge_sandbox }}", "read-only")
          .replaceAll("{{ output }}", JSON.stringify(join(workspace, "result.json")))
          .replace(/{{ output_schema:([^}]+) }}/g, (_: string, path: string) =>
            JSON.stringify(path),
          )
          .replace(/{{ prompt:([^}]+) }}/g, (_: string, path: string) => JSON.stringify(path));
        await execFileAsync("/bin/sh", ["-c", command], {
          cwd: workspace,
          env: {
            PATH: workspace + ":" + process.env.PATH,
            ARGS_PATH: argsPath,
            CODEX_API_KEY: "fixture-not-live",
          },
        });
        const args: string[] = JSON.parse(await readFile(argsPath, "utf8"));
        expect(args[args.indexOf("--model") + 1]).toBe(override ? "custom'judge" : "gpt-6.1-sol");
        expect(args).toContain("model_reasoning_effort=" + (override ? "medium" : "high"));
        expect(args).toContain("service_tier=default");
        expect(args).not.toContain("service_tier=fast");
        expect(args).toContain("--ignore-user-config");
        expect(args).toContain("--sandbox");
      } finally {
        await rm(workspace, { force: true, recursive: true });
      }
    },
  );
});
