import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { computeGitHubSkillFolderContentHash } from "../../convex/lib/githubSkillSync";
import type { SkillEvaluationRunRecord } from "../../src/components/SkillEvaluationReport";

const OFFICIAL_SKILL_SOURCES = new Set(["nvidia/skills"]);
const OFFICIAL_GITHUB_BRANCHES = new Map([
  ["nvidia/skills", "main"],
  ["nvidia/skillevaluator", "main"],
]);
const EVALS_DATASET_NAMES = ["evals.json", "evals.jsonl", "evals.yaml", "evals.yml"] as const;
const LEGACY_DATASET_NAMES = [
  "dataset.json",
  "dataset.jsonl",
  "dataset.yaml",
  "dataset.yml",
] as const;
const CONFIG_NAMES = ["config.yml", "config.yaml"] as const;
const LOCAL_EVALUATION_WEB_ROOT = "public/__skill-evaluator-demo";
const LOCAL_EVALUATION_WEB_BASE_URL = "/__skill-evaluator-demo";

type SkippedEvalDiscovery = {
  status: "skipped";
  reason:
    | "no-evals"
    | "unsupported-eval-layout"
    | "ambiguous-evals"
    | "ambiguous-evals-config"
    | "eval-source-config-mismatch";
  message: string;
  candidates?: string[];
};

type ReadyEvalDiscovery = {
  status: "ready";
  taskSource: "evals_json" | "native_harbor";
  evalDirectory: string;
  datasetPath?: string;
  configPath?: string;
};

export type SkillEvalDiscovery = SkippedEvalDiscovery | ReadyEvalDiscovery;

async function existingChildren(directory: string, names: readonly string[]) {
  const entries = new Set(await readdir(directory).catch(() => []));
  return names.filter((name) => entries.has(name)).map((name) => resolve(directory, name));
}

async function isDirectory(path: string) {
  return await lstat(path)
    .then((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .catch(() => false);
}

async function catalogEvalCandidates(skillDirectory: string) {
  const candidates = new Set<string>();
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name === "evals.json") {
        candidates.add(path);
      }
    }
  };
  await visit(skillDirectory);
  for (const directoryName of ["evals", "eval"] as const) {
    const directory = resolve(skillDirectory, directoryName);
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        candidates.add(resolve(directory, entry.name));
      }
    }
  }
  return [...candidates].sort();
}

async function configuredTaskSource(configPath: string | undefined) {
  if (!configPath) return "auto";
  try {
    const config = parseYaml(await readFile(configPath, "utf8")) as unknown;
    if (!config || typeof config !== "object" || Array.isArray(config)) return "auto";
    const harbor = (config as { harbor?: unknown }).harbor;
    if (!harbor || typeof harbor !== "object" || Array.isArray(harbor)) return "auto";
    const taskSource = (harbor as { task_source?: unknown }).task_source;
    return taskSource === "evals_json" || taskSource === "native_harbor" ? taskSource : "auto";
  } catch {
    return "auto";
  }
}

export async function discoverSkillEvals(skillDirectory: string): Promise<SkillEvalDiscovery> {
  const evalDirectory = resolve(skillDirectory, "evals");
  const legacyEvalDirectory = resolve(skillDirectory, "eval");
  const catalogDatasets = await catalogEvalCandidates(skillDirectory);
  const datasets = [
    ...(await existingChildren(evalDirectory, EVALS_DATASET_NAMES)),
    ...(await existingChildren(legacyEvalDirectory, LEGACY_DATASET_NAMES)),
  ];
  const harborDirectory = resolve(evalDirectory, "harbor");
  const hasNativeHarbor = await isDirectory(harborDirectory);
  if (!(await isDirectory(evalDirectory)) && datasets.length === 0 && !hasNativeHarbor) {
    if (catalogDatasets.length > 0) {
      return {
        status: "skipped",
        reason: "unsupported-eval-layout",
        message:
          "NVIDIA catalog eval data exists, but this SkillEvaluator Tier 3 version cannot consume its layout directly.",
        candidates: catalogDatasets,
      };
    }
    return {
      status: "skipped",
      reason: "no-evals",
      message: "No SkillEvaluator dataset or native Harbor tasks were found in evals/.",
    };
  }

  if (datasets.length > 1) {
    return {
      status: "skipped",
      reason: "ambiguous-evals",
      message: "Multiple supported SkillEvaluator dataset files were found.",
      candidates: datasets,
    };
  }

  const configs = await existingChildren(evalDirectory, CONFIG_NAMES);
  if (configs.length > 1) {
    return {
      status: "skipped",
      reason: "ambiguous-evals-config",
      message: "Both evals/config.yml and evals/config.yaml were found.",
      candidates: configs,
    };
  }

  const configPath = configs[0];
  const taskSource = await configuredTaskSource(configPath);

  if (taskSource === "evals_json" && !datasets[0]) {
    return {
      status: "skipped",
      reason: "eval-source-config-mismatch",
      message: "evals/config selects evals_json, but no supported dataset file was found.",
    };
  }
  if (taskSource === "native_harbor" && !hasNativeHarbor) {
    return {
      status: "skipped",
      reason: "eval-source-config-mismatch",
      message: "evals/config selects native_harbor, but evals/harbor is missing.",
    };
  }

  // SkillEvaluator's auto mode deliberately prefers a dataset over native Harbor.
  // An explicit task_source overrides that precedence.
  if (taskSource === "native_harbor") {
    return {
      status: "ready",
      taskSource: "native_harbor",
      evalDirectory,
      configPath,
    };
  }

  if (datasets[0]) {
    return {
      status: "ready",
      taskSource: "evals_json",
      evalDirectory: dirname(datasets[0]),
      datasetPath: datasets[0],
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

  if (catalogDatasets.length > 0) {
    return {
      status: "skipped",
      reason: "unsupported-eval-layout",
      message:
        "NVIDIA catalog eval data exists, but this SkillEvaluator Tier 3 version cannot consume its layout directly.",
      candidates: catalogDatasets,
    };
  }

  return {
    status: "skipped",
    reason: "no-evals",
    message: "No SkillEvaluator dataset or native Harbor tasks were found in evals/.",
  };
}

export type OfficialSkillEvaluationInput = {
  checkoutPath: string;
  sourceRepo: string;
  sourceCommit: string;
  sourcePath: string;
  contentHash: string;
  previousContentHash: string | null;
};

function normalizeSourcePath(checkoutPath: string, sourcePath: string) {
  if (isAbsolute(sourcePath)) {
    throw new Error("sourcePath must be relative to the source repository");
  }
  const checkoutRoot = resolve(checkoutPath);
  const normalizedPath = relative(checkoutRoot, resolve(checkoutRoot, sourcePath));
  if (
    !normalizedPath ||
    normalizedPath === ".." ||
    normalizedPath.startsWith(`..${sep}`) ||
    isAbsolute(normalizedPath)
  ) {
    throw new Error("sourcePath must stay inside the source repository");
  }
  return normalizedPath.split(sep).join("/");
}

export function buildTier3EvaluateInvocation({
  evaluatorRepoPath,
  skillDirectory,
  resultsDirectory,
  model,
}: {
  evaluatorRepoPath: string;
  skillDirectory: string;
  resultsDirectory: string;
  model: string;
}) {
  return {
    command: [
      "uv",
      "run",
      "--project",
      evaluatorRepoPath,
      "skillevaluator",
      "tier3",
      "evaluate",
      skillDirectory,
      "--agents",
      "codex",
      // Local mode is limited to allowlisted commits merged into the configured official branch.
      // A production sync must replace this demo boundary with an isolated execution sandbox.
      "--env-mode",
      "local",
      "--agent-model",
      `codex=${model}`,
      "--n-attempts",
      "1",
      "--n-concurrent",
      "1",
      "--max-agents",
      "1",
      "--progress",
      "plain",
      "--results-dir",
      resultsDirectory,
    ],
    environment: {
      SKILL_EVAL_LLM_MODEL: model,
      SKILL_EVAL_LLM_PROVIDER: "openai",
    },
  };
}

export async function planOfficialSkillEvaluation(input: OfficialSkillEvaluationInput) {
  const sourceRepo = input.sourceRepo.trim().toLowerCase();
  if (!OFFICIAL_SKILL_SOURCES.has(sourceRepo)) {
    return {
      action: "skip" as const,
      reason: "unapproved-source" as const,
      message: `${sourceRepo} is not an allowlisted official skill source.`,
    };
  }

  if (input.previousContentHash === input.contentHash) {
    return {
      action: "skip" as const,
      reason: "unchanged-version" as const,
      message: "ClawHub already observed this exact skill content hash.",
    };
  }

  const checkoutPath = resolve(input.checkoutPath);
  const relativeSkillPath = normalizeSourcePath(checkoutPath, input.sourcePath);
  const skillDirectory = resolve(checkoutPath, relativeSkillPath);

  const evals = await discoverSkillEvals(skillDirectory);
  if (evals.status === "skipped") {
    return {
      action: "skip" as const,
      reason: evals.reason,
      message: evals.message,
      evals,
    };
  }

  return {
    action: "run" as const,
    sourceRepo,
    sourceCommit: input.sourceCommit,
    sourcePath: relativeSkillPath,
    contentHash: input.contentHash,
    skillDirectory,
    evals,
  };
}

async function capture(
  command: string[],
  options: { cwd?: string; environment?: Record<string, string> } = {},
) {
  const [executable, ...args] = command;
  if (!executable) throw new Error("Cannot run an empty command");
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8").trim();
      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      if (exitCode !== 0) {
        reject(
          new Error(
            `${command.join(" ")} failed (${exitCode ?? "unknown"}): ${stderrText || stdoutText}`,
          ),
        );
        return;
      }
      resolvePromise(stdoutText);
    });
  });
}

async function assertCleanGitCheckout(checkoutPath: string, label: string) {
  const status = await capture([
    "git",
    "-C",
    checkoutPath,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status) {
    throw new Error(
      `${label} checkout must be clean so the recorded commit exactly identifies evaluated bytes.`,
    );
  }
}

function githubRepositoryFromRemote(remote: string) {
  const normalized = remote.trim().replace(/\.git$/i, "");
  const match =
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/i.exec(
      normalized,
    );
  return match?.[1]?.toLowerCase() ?? null;
}

async function assertOfficialGitHubCheckout(
  checkoutPath: string,
  expectedRepository: string,
  label: string,
) {
  const remote = await capture(["git", "-C", checkoutPath, "remote", "get-url", "origin"]);
  if (githubRepositoryFromRemote(remote) !== expectedRepository.toLowerCase()) {
    throw new Error(`${label} checkout origin must be github.com/${expectedRepository}.`);
  }
}

function officialGitHubRemoteUrl(repository: string) {
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository)) {
    throw new Error(`Invalid GitHub repository identity: ${repository}`);
  }
  return `https://github.com/${repository}.git`;
}

async function materializeOfficialGitHubSnapshot(
  repository: string,
  commit: string,
  label: string,
) {
  const approvedBranch = OFFICIAL_GITHUB_BRANCHES.get(repository.toLowerCase());
  if (!approvedBranch) throw new Error(`No approved branch configured for ${repository}.`);
  const snapshotRoot = await mkdtemp(join(tmpdir(), "clawhub-skill-eval-snapshot-"));
  process.once("exit", () => rmSync(snapshotRoot, { recursive: true, force: true }));
  const snapshotPath = join(snapshotRoot, "checkout");
  await capture(["git", "init", "--quiet", snapshotPath]);
  await capture([
    "git",
    "-C",
    snapshotPath,
    "remote",
    "add",
    "origin",
    officialGitHubRemoteUrl(repository),
  ]);
  await capture([
    "git",
    "-C",
    snapshotPath,
    "fetch",
    "--quiet",
    "--filter=blob:none",
    "--no-tags",
    "origin",
    `refs/heads/${approvedBranch}:refs/remotes/origin/${approvedBranch}`,
  ]);
  const branchRef = `refs/remotes/origin/${approvedBranch}`;
  const isApprovedCommit = await new Promise<boolean>((resolvePromise, reject) => {
    const child = spawn(
      "git",
      ["-C", snapshotPath, "merge-base", "--is-ancestor", commit, branchRef],
      { stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolvePromise(true);
      else if (exitCode === 1) resolvePromise(false);
      else reject(new Error(`${label} approved-branch ancestry check failed (${exitCode}).`));
    });
  });
  if (!isApprovedCommit) {
    throw new Error(`${label} commit must be merged into ${repository}#${approvedBranch}.`);
  }
  await capture(["git", "-C", snapshotPath, "checkout", "--quiet", "--detach", commit]);
  const snapshotCommit = await capture(["git", "-C", snapshotPath, "rev-parse", "HEAD"]);
  if (snapshotCommit !== commit) throw new Error(`${label} snapshot did not resolve to ${commit}.`);
  return snapshotPath;
}

const EVALUATOR_HOST_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "SKILLEVALUATOR_RUNTIME_DIR",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "SKILL_EVAL_LLM_API_KEY",
  "SKILL_EVAL_LLM_BASE_URL",
] as const;

const EVALUATOR_INVOCATION_ENV_ALLOWLIST = new Set([
  "SKILL_EVAL_LLM_MODEL",
  "SKILL_EVAL_LLM_PROVIDER",
]);

export function buildEvaluatorProcessEnvironment(
  hostEnvironment: NodeJS.ProcessEnv,
  invocationEnvironment: Record<string, string>,
  cwd: string,
) {
  const environment: Record<string, string> = { PWD: cwd };
  for (const key of EVALUATOR_HOST_ENV_ALLOWLIST) {
    const value = hostEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(invocationEnvironment)) {
    if (!EVALUATOR_INVOCATION_ENV_ALLOWLIST.has(key)) {
      throw new Error(`Unsupported SkillEvaluator environment variable: ${key}`);
    }
    environment[key] = value;
  }
  return environment;
}

async function runVisible(command: string[], environment: Record<string, string>, cwd: string) {
  const [executable, ...args] = command;
  if (!executable) throw new Error("Cannot run an empty command");
  return await new Promise<number>((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: buildEvaluatorProcessEnvironment(process.env, environment, cwd),
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise(exitCode ?? 1));
  });
}

async function gitTrackedEntries(checkoutPath: string, sourcePath: string) {
  const output = await capture(["git", "-C", checkoutPath, "ls-files", "-z", "--", sourcePath]);
  const entries: Record<string, Uint8Array> = {};
  for (const path of output.split("\0").filter(Boolean)) {
    const absolutePath = resolve(checkoutPath, path);
    const file = await lstat(absolutePath);
    if (file.isSymbolicLink() || !file.isFile()) {
      throw new Error(`Tracked skill entry must be a regular file: ${path}`);
    }
    entries[path] = new Uint8Array(await readFile(absolutePath));
  }
  return entries;
}

async function readSourceVersion(skillDirectory: string) {
  const markdown = await readFile(resolve(skillDirectory, "SKILL.md"), "utf8");
  const frontmatter = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/u.exec(markdown)?.[1];
  const version = frontmatter
    ? /^version:\s*["']?([^\s"']+)["']?\s*$/mu.exec(frontmatter)?.[1]
    : null;
  return version?.trim() || null;
}

async function sha256File(path: string | undefined) {
  if (!path) return null;
  const bytes = await readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function withFilesystemLock<T>(lockPath: string, operation: () => Promise<T>) {
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt >= 399) {
        throw new Error(`Timed out waiting for local evaluation lock: ${lockPath}`);
      }
      await delay(25);
    }
  }
  try {
    return await operation();
  } finally {
    await rmdir(lockPath);
  }
}

async function copyFileAtomically(source: string, destination: string) {
  await mkdir(dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, await readFile(source));
    await rename(temporaryPath, destination);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function republishDurableArtifact(
  durableArtifactDirectory: string,
  webArtifactDirectory: string,
) {
  const durableRecord = await readJsonFile<SkillEvaluationRunRecord | null>(
    join(durableArtifactDirectory, "evaluation.json"),
    null,
  );
  if (!durableRecord) return false;
  const files = [
    "evaluation.json",
    ...(durableRecord.state === "completed"
      ? ["report.html", "result.json", "run_config.json"]
      : []),
  ];
  for (const file of files) {
    const source = join(durableArtifactDirectory, file);
    const sourceEntry = await lstat(source).catch(() => null);
    if (!sourceEntry?.isFile() || sourceEntry.isSymbolicLink()) return false;
  }
  await mkdir(webArtifactDirectory, { recursive: true });
  await Promise.all(
    files.map((file) =>
      copyFileAtomically(join(durableArtifactDirectory, file), join(webArtifactDirectory, file)),
    ),
  );
  return true;
}

function artifactIdentitySegments(sourceRepo: string, contentHash: string, sourcePath: string) {
  const segments = [...sourceRepo.split("/"), contentHash, ...sourcePath.split("/")];
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Artifact identity contains an unsafe path segment");
  }
  return segments;
}

function artifactRelativeDirectory(sourceRepo: string, contentHash: string, sourcePath: string) {
  return join(...artifactIdentitySegments(sourceRepo, contentHash, sourcePath));
}

export function buildLocalEvaluationArtifactBaseUrl(
  sourceRepo: string,
  contentHash: string,
  sourcePath: string,
) {
  const encodedPath = artifactIdentitySegments(sourceRepo, contentHash, sourcePath)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${LOCAL_EVALUATION_WEB_BASE_URL}/${encodedPath}`;
}

async function findLatestRunDirectory(resultsRoot: string) {
  const candidates: Array<{ path: string; modifiedAt: number }> = [];
  for (const skillEntry of await readdir(resultsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!skillEntry.isDirectory()) continue;
    const skillResults = join(resultsRoot, skillEntry.name);
    for (const runEntry of await readdir(skillResults, { withFileTypes: true })) {
      if (!runEntry.isDirectory() || runEntry.name === "latest") continue;
      const runDirectory = join(skillResults, runEntry.name);
      const resultPath = join(runDirectory, "result.json");
      try {
        candidates.push({ path: runDirectory, modifiedAt: (await stat(resultPath)).mtimeMs });
      } catch {
        // Failed/incomplete runs without result.json are not renderable upstream reports.
      }
    }
  }
  return candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)[0]?.path ?? null;
}

type SyncState = Record<string, { contentHash: string; commit: string; observedAt: string }>;

export async function updateLocalEvaluationSyncState({
  statePath,
  stateKey,
  contentHash,
  commit,
  observedAt,
}: {
  statePath: string;
  stateKey: string;
  contentHash: string;
  commit: string;
  observedAt: string;
}) {
  await withFilesystemLock(`${statePath}.lock`, async () => {
    const latestState = await readJsonFile<SyncState>(statePath, {});
    latestState[stateKey] = { contentHash, commit, observedAt };
    await writeJson(statePath, latestState);
  });
}

type EvaluationIndex = {
  schemaVersion: 1;
  evaluations: Array<{
    repository: string;
    commit: string;
    path: string;
    contentHash: string;
  }>;
};

export async function updateLocalEvaluationIndex({
  webRoot,
  repository,
  commit,
  sourcePath,
  contentHash,
}: {
  webRoot: string;
  repository: string;
  commit: string;
  sourcePath: string;
  contentHash: string;
}) {
  const indexPath = join(webRoot, "index.json");
  await withFilesystemLock(`${indexPath}.lock`, async () => {
    const index = await readJsonFile<EvaluationIndex>(indexPath, {
      schemaVersion: 1,
      evaluations: [],
    });
    if (index.schemaVersion !== 1 || !Array.isArray(index.evaluations)) {
      throw new Error("Unsupported local evaluation index");
    }
    const evaluations = index.evaluations.filter(
      (entry) =>
        !(entry.repository === repository && entry.commit === commit && entry.path === sourcePath),
    );
    evaluations.push({ repository, commit, path: sourcePath, contentHash });
    evaluations.sort((left, right) =>
      [left.repository, left.commit, left.path]
        .join(":")
        .localeCompare([right.repository, right.commit, right.path].join(":")),
    );
    await writeJson(indexPath, { schemaVersion: 1, evaluations } satisfies EvaluationIndex);
  });
}

function relativeRepoPath(checkoutPath: string, path: string | undefined) {
  if (!path) return null;
  return relative(checkoutPath, path).split(sep).join("/");
}

async function main() {
  const { values } = parseArgs({
    options: {
      "skills-repo-path": { type: "string" },
      "evaluator-repo-path": { type: "string" },
      "skill-path": { type: "string" },
      "source-repo": { type: "string", default: "nvidia/skills" },
      "output-dir": { type: "string", default: ".artifacts/skill-evaluator-demo" },
      model: { type: "string", default: "gpt-5.4-mini" },
      rerun: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values["skills-repo-path"] || !values["evaluator-repo-path"] || !values["skill-path"]) {
    throw new Error("--skills-repo-path, --evaluator-repo-path, and --skill-path are required");
  }

  const requestedCheckoutPath = resolve(values["skills-repo-path"]);
  const requestedEvaluatorRepoPath = resolve(values["evaluator-repo-path"]);
  let checkoutPath = requestedCheckoutPath;
  let evaluatorRepoPath = requestedEvaluatorRepoPath;
  const sourcePath = normalizeSourcePath(checkoutPath, values["skill-path"]);
  const sourceRepo = values["source-repo"].trim().toLowerCase();
  if (!OFFICIAL_SKILL_SOURCES.has(sourceRepo)) {
    throw new Error(`${sourceRepo} is not an allowlisted official skill source.`);
  }
  const outputDirectory = resolve(values["output-dir"]);
  const webRoot = resolve(LOCAL_EVALUATION_WEB_ROOT);
  const model = values.model;
  const sourceCommit = await capture(["git", "-C", checkoutPath, "rev-parse", "HEAD"]);
  const evaluatorCommit = await capture(["git", "-C", evaluatorRepoPath, "rev-parse", "HEAD"]);
  await Promise.all([
    assertCleanGitCheckout(checkoutPath, "Skill source"),
    assertCleanGitCheckout(evaluatorRepoPath, "SkillEvaluator"),
    assertOfficialGitHubCheckout(checkoutPath, sourceRepo, "Skill source"),
    assertOfficialGitHubCheckout(evaluatorRepoPath, "nvidia/skillevaluator", "SkillEvaluator"),
  ]);
  [checkoutPath, evaluatorRepoPath] = await Promise.all([
    materializeOfficialGitHubSnapshot(sourceRepo, sourceCommit, "Skill source"),
    materializeOfficialGitHubSnapshot("nvidia/skillevaluator", evaluatorCommit, "SkillEvaluator"),
  ]);
  const evaluatorVersion = await capture(
    ["uv", "run", "--project", evaluatorRepoPath, "skillevaluator", "--version"],
    {
      cwd: evaluatorRepoPath,
      environment: buildEvaluatorProcessEnvironment(process.env, {}, evaluatorRepoPath),
    },
  );
  const trackedEntries = await gitTrackedEntries(checkoutPath, sourcePath);
  const contentHash = await computeGitHubSkillFolderContentHash(trackedEntries, sourcePath);
  const statePath = join(outputDirectory, "sync-state.json");
  const stateKey = `${sourceRepo}:${sourcePath}`;
  const syncState = await readJsonFile<SyncState>(statePath, {});
  const previousContentHash = values.rerun ? null : (syncState[stateKey]?.contentHash ?? null);
  const plan = await planOfficialSkillEvaluation({
    checkoutPath,
    sourceRepo,
    sourceCommit,
    sourcePath,
    contentHash,
    previousContentHash,
  });
  const now = new Date();
  const relativeArtifactDirectory = artifactRelativeDirectory(sourceRepo, contentHash, sourcePath);
  const durableArtifactDirectory = join(outputDirectory, "runs", relativeArtifactDirectory);
  const webArtifactDirectory = join(webRoot, relativeArtifactDirectory);
  const manifestPath = join(webArtifactDirectory, "evaluation.json");
  const manifestBaseUrl = buildLocalEvaluationArtifactBaseUrl(sourceRepo, contentHash, sourcePath);
  if (values.rerun) {
    const existingRecord = await readJsonFile<SkillEvaluationRunRecord | null>(
      join(durableArtifactDirectory, "evaluation.json"),
      null,
    );
    if (
      existingRecord?.source.contentHash === contentHash &&
      existingRecord.source.commit !== sourceCommit
    ) {
      throw new Error(
        "A content-identical artifact already belongs to another evaluated commit; this prototype will not overwrite its provenance.",
      );
    }
  }
  const skillDirectory = resolve(checkoutPath, sourcePath);
  const discovery = plan.action === "run" ? plan.evals : await discoverSkillEvals(skillDirectory);
  const recordBase = {
    schemaVersion: 1 as const,
    smokeRun: true,
    source: {
      repository: sourceRepo,
      commit: sourceCommit,
      path: sourcePath,
      contentHash,
      upstreamVersion: await readSourceVersion(skillDirectory).catch(() => null),
    },
    evals: {
      directory:
        discovery.status === "ready"
          ? (relativeRepoPath(checkoutPath, discovery.evalDirectory) ?? `${sourcePath}/evals`)
          : `${sourcePath}/evals`,
      taskSource: discovery.status === "ready" ? discovery.taskSource : null,
      dataset:
        discovery.status === "ready" ? relativeRepoPath(checkoutPath, discovery.datasetPath) : null,
      config:
        discovery.status === "ready" ? relativeRepoPath(checkoutPath, discovery.configPath) : null,
    },
    evaluator: {
      repository: "NVIDIA/SkillEvaluator" as const,
      commit: evaluatorCommit,
      version: evaluatorVersion.replace(/^skillevaluator(?:,\s*version)?\s+/i, ""),
      agent: "codex",
      model,
      provider: "openai",
      environment: "local",
      attempts: 1,
    },
    timing: { startedAt: now.toISOString() },
  };

  const recordTerminalSyncState = async () => {
    await updateLocalEvaluationSyncState({
      statePath,
      stateKey,
      contentHash,
      commit: sourceCommit,
      observedAt: now.toISOString(),
    });
  };

  const indexCurrentObservation = async () => {
    if (!OFFICIAL_SKILL_SOURCES.has(sourceRepo)) return;
    await updateLocalEvaluationIndex({
      webRoot,
      repository: sourceRepo,
      commit: sourceCommit,
      sourcePath,
      contentHash,
    });
  };

  const recordFailedEvaluation = async (reason: { code: string; message: string }) => {
    const failedRecord: SkillEvaluationRunRecord = {
      ...recordBase,
      state: "failed",
      timing: { ...recordBase.timing, finishedAt: new Date().toISOString() },
      reason,
    };
    await Promise.all([
      writeJson(join(durableArtifactDirectory, "evaluation.json"), failedRecord),
      writeJson(manifestPath, failedRecord),
    ]);
    await indexCurrentObservation();
    await recordTerminalSyncState();
    console.log(JSON.stringify(failedRecord, null, 2));
    process.exitCode = 1;
  };

  if (plan.action === "skip" && plan.reason === "unchanged-version") {
    if (!(await republishDurableArtifact(durableArtifactDirectory, webArtifactDirectory))) {
      throw new Error(
        "The unchanged skill has no complete durable artifact to publish; rerun with --rerun.",
      );
    }
    await indexCurrentObservation();
    console.log(
      JSON.stringify(
        {
          event: "official-skill-evaluation-skipped",
          source: recordBase.source,
          reason: { code: plan.reason, message: plan.message },
          preservedManifest: manifestPath,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (plan.action === "skip") {
    const record: SkillEvaluationRunRecord = {
      ...recordBase,
      state: "skipped",
      timing: { ...recordBase.timing, finishedAt: new Date().toISOString() },
      reason: { code: plan.reason, message: plan.message },
    };
    await Promise.all([
      writeJson(join(durableArtifactDirectory, "evaluation.json"), record),
      writeJson(manifestPath, record),
    ]);
    await indexCurrentObservation();
    await recordTerminalSyncState();
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  const datasetHash = await sha256File(plan.evals.datasetPath);
  const configHash = await sha256File(plan.evals.configPath);
  // Codex discovers project config by walking parent directories. Keep Harbor's ephemeral
  // workspaces outside the linked ClawHub worktree so an evaluation cannot inherit its hooks.
  const resultsDirectory = await mkdtemp(join(tmpdir(), "clawhub-skill-eval-results-"));
  const invocation = buildTier3EvaluateInvocation({
    evaluatorRepoPath,
    skillDirectory,
    resultsDirectory,
    model,
  });
  const pendingRecord: SkillEvaluationRunRecord = { ...recordBase, state: "pending" };
  await Promise.all([
    writeJson(join(durableArtifactDirectory, "evaluation.json"), {
      ...pendingRecord,
      provenance: {
        datasetSha256: datasetHash,
        configSha256: configHash,
        command: invocation.command,
      },
    }),
    writeJson(manifestPath, pendingRecord),
  ]);
  await indexCurrentObservation();

  const validateCommand = [
    "uv",
    "run",
    "--project",
    evaluatorRepoPath,
    "skillevaluator",
    "tier3",
    "validate",
    skillDirectory,
    "--json",
  ];
  let validationExitCode: number;
  let evaluationExitCode: number | null;
  try {
    validationExitCode = await runVisible(validateCommand, invocation.environment, checkoutPath);
    evaluationExitCode =
      validationExitCode === 0
        ? await runVisible(invocation.command, invocation.environment, checkoutPath)
        : null;
  } catch (error) {
    await recordFailedEvaluation({
      code: "evaluator-invocation-failed",
      message:
        error instanceof Error
          ? `Unable to launch SkillEvaluator: ${error.message}`
          : "Unable to launch SkillEvaluator.",
    });
    return;
  }
  const latestRunDirectory = await findLatestRunDirectory(resultsDirectory);

  if (validationExitCode !== 0 || evaluationExitCode !== 0 || !latestRunDirectory) {
    const failure =
      validationExitCode !== 0
        ? {
            code: "eval-contract-invalid",
            message: `SkillEvaluator tier3 validate exited with code ${validationExitCode}.`,
          }
        : evaluationExitCode !== 0
          ? {
              code: "evaluator-failed",
              message: `SkillEvaluator tier3 evaluate exited with code ${evaluationExitCode ?? "unknown"}.`,
            }
          : {
              code: "evaluator-output-missing",
              message:
                "SkillEvaluator exited successfully but produced no renderable result.json run.",
            };
    await recordFailedEvaluation(failure);
    return;
  }

  let completedRecord: SkillEvaluationRunRecord;
  try {
    await mkdir(webArtifactDirectory, { recursive: true });
    const artifactFiles = ["report.html", "result.json", "run_config.json"] as const;
    for (const file of artifactFiles) {
      await copyFileAtomically(join(latestRunDirectory, file), join(webArtifactDirectory, file));
      await copyFile(join(latestRunDirectory, file), join(durableArtifactDirectory, file));
    }
    completedRecord = {
      ...recordBase,
      state: "completed",
      timing: { ...recordBase.timing, finishedAt: new Date().toISOString() },
      artifacts: {
        reportUrl: `${manifestBaseUrl}/report.html`,
        resultUrl: `${manifestBaseUrl}/result.json`,
        runConfigUrl: `${manifestBaseUrl}/run_config.json`,
      },
    };
    await Promise.all([
      writeJson(join(durableArtifactDirectory, "evaluation.json"), {
        ...completedRecord,
        provenance: {
          datasetSha256: datasetHash,
          configSha256: configHash,
          command: invocation.command,
        },
      }),
      writeJson(manifestPath, completedRecord),
    ]);
  } catch {
    await recordFailedEvaluation({
      code: "artifact-publication-failed",
      message: "SkillEvaluator completed, but its native report artifacts could not be published.",
    });
    return;
  }
  await recordTerminalSyncState();
  console.log(JSON.stringify(completedRecord, null, 2));
}

if (import.meta.main) {
  await main();
}
