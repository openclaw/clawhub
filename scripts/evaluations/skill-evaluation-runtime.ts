import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { lstat, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";

const EVALS_DATASET_NAMES = ["evals.json", "evals.jsonl", "evals.yaml", "evals.yml"] as const;
const CONFIG_NAMES = ["config.yml", "config.yaml"] as const;
const MAX_CAPTURED_COMMAND_OUTPUT_BYTES = 512 * 1024;

export type SkillEvalDiscovery =
  | {
      status: "skipped";
      reason:
        | "no-evals"
        | "unsupported-eval-layout"
        | "ambiguous-evals-config"
        | "eval-source-config-mismatch";
      message: string;
    }
  | {
      status: "ready";
      taskSource: "evals_json" | "native_harbor";
      evalDirectory: string;
      datasetPath?: string;
      configPath?: string;
    };

async function existingChildren(directory: string, names: readonly string[]) {
  const entries = new Set(await readdir(directory).catch(() => []));
  return names.filter((name) => entries.has(name)).map((name) => resolve(directory, name));
}

async function isDirectory(path: string) {
  return lstat(path)
    .then((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .catch(() => false);
}

async function isFile(path: string) {
  return lstat(path)
    .then((entry) => entry.isFile() && !entry.isSymbolicLink())
    .catch(() => false);
}

async function catalogEvalCandidates(skillDirectory: string) {
  const candidates = new Set<string>();
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && EVALS_DATASET_NAMES.some((name) => name === entry.name)) {
        candidates.add(path);
      }
    }
  };
  await visit(skillDirectory);
  return [...candidates];
}

async function configuredTaskSource(configPath: string | undefined) {
  if (!configPath) return "auto" as const;
  try {
    const config = parseYaml(await readFile(configPath, "utf8")) as unknown;
    if (!config || typeof config !== "object" || Array.isArray(config)) return "auto" as const;
    const harbor = (config as { harbor?: unknown }).harbor;
    if (!harbor || typeof harbor !== "object" || Array.isArray(harbor)) return "auto" as const;
    const taskSource = (harbor as { task_source?: unknown }).task_source;
    return taskSource === "evals_json" || taskSource === "native_harbor"
      ? taskSource
      : ("auto" as const);
  } catch {
    return "auto" as const;
  }
}

export async function discoverSkillEvals(skillDirectory: string): Promise<SkillEvalDiscovery> {
  const evalDirectory = resolve(skillDirectory, "evals");
  const catalogDatasets = await catalogEvalCandidates(skillDirectory);
  const datasets = (
    await Promise.all(
      EVALS_DATASET_NAMES.map(async (name) => {
        const candidate = resolve(evalDirectory, name);
        return (await isFile(candidate)) ? candidate : null;
      }),
    )
  ).filter((candidate): candidate is string => Boolean(candidate));
  const datasetPath = datasets[0];
  const hasDataset = Boolean(datasetPath);
  const harborDirectory = resolve(evalDirectory, "harbor");
  const hasNativeHarbor = await isDirectory(harborDirectory);
  const configs = await existingChildren(evalDirectory, CONFIG_NAMES);
  if (configs.length > 1) {
    return {
      status: "skipped",
      reason: "ambiguous-evals-config",
      message: "Both evals/config.yml and evals/config.yaml were found.",
    };
  }
  const configPath = configs[0];
  const taskSource = await configuredTaskSource(configPath);
  if (taskSource === "evals_json" && !hasDataset) {
    return {
      status: "skipped",
      reason: "eval-source-config-mismatch",
      message: "evals/config selects evals_json, but no supported dataset was found.",
    };
  }
  if (taskSource === "native_harbor" && !hasNativeHarbor) {
    return {
      status: "skipped",
      reason: "eval-source-config-mismatch",
      message: "evals/config selects native_harbor, but evals/harbor is missing.",
    };
  }
  if (!hasDataset && !hasNativeHarbor) {
    return catalogDatasets.length > 0
      ? {
          status: "skipped",
          reason: "unsupported-eval-layout",
          message: "The repository contains eval data outside SkillEvaluator's supported layout.",
        }
      : {
          status: "skipped",
          reason: "no-evals",
          message: "No SkillEvaluator dataset or native Harbor tasks were found.",
        };
  }
  if (taskSource === "native_harbor") {
    return { status: "ready", taskSource, evalDirectory, configPath };
  }
  if (datasetPath) {
    return {
      status: "ready",
      taskSource: "evals_json",
      evalDirectory: dirname(datasetPath),
      datasetPath,
      ...(configPath ? { configPath } : {}),
    };
  }
  if (hasNativeHarbor) {
    return {
      status: "ready",
      taskSource: "native_harbor",
      evalDirectory,
      ...(configPath ? { configPath } : {}),
    };
  }
  return {
    status: "skipped",
    reason: catalogDatasets.length > 0 ? "unsupported-eval-layout" : "no-evals",
    message:
      catalogDatasets.length > 0
        ? "The repository contains eval data outside SkillEvaluator's supported layout."
        : "No SkillEvaluator dataset or native Harbor tasks were found.",
  };
}

export function resolveRepositoryPath(checkoutPath: string, sourcePath: string) {
  if (isAbsolute(sourcePath)) throw new Error("Skill source path must be repository-relative");
  const root = resolve(checkoutPath);
  const normalized = relative(root, resolve(root, sourcePath));
  if (!normalized || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error("Skill source path escaped its repository");
  }
  return resolve(root, normalized);
}

export async function runCommand(
  command: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    inheritOutput?: boolean;
    timeoutMs?: number;
  } = {},
) {
  const [executable, ...args] = command;
  if (!executable) throw new Error("Cannot run an empty command");
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolvePromise, reject) => {
      const child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: options.inheritOutput ? "inherit" : ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const appendOutput = (current: string, chunk: Buffer) =>
        `${current}${chunk.toString("utf8")}`.slice(-MAX_CAPTURED_COMMAND_OUTPUT_BYTES);
      let timedOut = false;
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
          }, options.timeoutMs)
        : undefined;
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = appendOutput(stdout, chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = appendOutput(stderr, chunk);
      });
      child.on("error", (error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (exitCode) => {
        if (timeout) clearTimeout(timeout);
        resolvePromise({
          exitCode: timedOut ? 124 : (exitCode ?? 1),
          stdout,
          stderr: timedOut ? `${stderr}\nCommand timed out` : stderr,
        });
      });
    },
  );
}

async function requireSuccessful(command: string[], cwd?: string) {
  const result = await runCommand(command, { cwd, env: process.env as Record<string, string> });
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(-4_000);
    throw new Error(`${command[0]} failed (${result.exitCode}): ${detail}`);
  }
  return result.stdout.trim();
}

export async function materializeNvidiaSkillsSnapshot(commit: string) {
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("Invalid NVIDIA source commit");
  const root = await mkdtemp(join(tmpdir(), "clawhub-nvidia-eval-"));
  const checkout = join(root, "skills");
  await requireSuccessful(["git", "init", "--quiet", checkout]);
  await requireSuccessful([
    "git",
    "-C",
    checkout,
    "remote",
    "add",
    "origin",
    "https://github.com/NVIDIA/skills.git",
  ]);
  await requireSuccessful([
    "git",
    "-C",
    checkout,
    "fetch",
    "--quiet",
    "--filter=blob:none",
    "--no-tags",
    "origin",
    "refs/heads/main:refs/remotes/origin/main",
  ]);
  const ancestry = await runCommand(
    ["git", "-C", checkout, "merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"],
    { env: process.env as Record<string, string> },
  );
  if (ancestry.exitCode !== 0) {
    rmSync(root, { recursive: true, force: true });
    throw new Error("NVIDIA source commit is not merged into the official main branch");
  }
  await requireSuccessful(["git", "-C", checkout, "checkout", "--quiet", "--detach", commit]);
  return { root, checkout };
}

export function buildTier3Commands(args: {
  evaluatorProject: string;
  skillDirectory: string;
  resultsDirectory: string;
  agent: string;
  agentModel: string;
  attempts: number;
  environment: string;
}) {
  const prefix = [
    "uv",
    "run",
    "--project",
    args.evaluatorProject,
    "--extra",
    "tier3",
    "skillevaluator",
  ];
  return {
    validate: [...prefix, "tier3", "validate", args.skillDirectory, "--json"],
    evaluate: [
      ...prefix,
      "tier3",
      "evaluate",
      args.skillDirectory,
      "--agents",
      args.agent,
      "--env-mode",
      args.environment,
      "--agent-model",
      `${args.agent}=${args.agentModel}`,
      "--n-attempts",
      String(args.attempts),
      "--no-stop-on-pass",
      "--n-concurrent",
      "1",
      "--max-agents",
      "1",
      "--progress",
      "plain",
      "--results-dir",
      args.resultsDirectory,
    ],
  };
}

export async function findLatestResultJson(resultsRoot: string) {
  const candidates: Array<{ path: string; modifiedAt: number }> = [];
  for (const skillEntry of await readdir(resultsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!skillEntry.isDirectory()) continue;
    const skillResults = join(resultsRoot, skillEntry.name);
    for (const runEntry of await readdir(skillResults, { withFileTypes: true })) {
      if (!runEntry.isDirectory() || runEntry.name === "latest") continue;
      const resultPath = join(skillResults, runEntry.name, "result.json");
      try {
        candidates.push({ path: resultPath, modifiedAt: (await stat(resultPath)).mtimeMs });
      } catch {
        // Incomplete runs do not produce a native result.
      }
    }
  }
  return candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)[0]?.path ?? null;
}
