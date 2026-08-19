import { readFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  NVIDIA_SKILL_EVALUATION_CONFIG,
  NVIDIA_SKILL_EVALUATION_CONFIG_KEY,
} from "../../convex/lib/skillEvaluationConfig";
import { createWorkerLogger } from "../lib/workerLogger";
import { maskKnownWorkerSecrets, redactWorkerPublicText } from "../lib/workerRedaction";
import {
  buildTier3Commands,
  discoverSkillEvals,
  findLatestResultJson,
  materializeNvidiaSkillsSnapshot,
  resolveRepositoryPath,
  runCommand,
} from "./skill-evaluation-runtime";

type ClaimedEvaluation = Doc<"skillEvaluationRuns"> & { leaseToken: string };
type WorkerClient = Pick<ConvexHttpClient, "action">;

const logger = createWorkerLogger({ name: "skill-evaluation-worker" });
const EVALUATION_TIMEOUT_MS = 160 * 60 * 1000;
const VALIDATION_TIMEOUT_MS = 5 * 60 * 1000;

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function workerId(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.SKILL_EVALUATION_WORKER_ID ??
    `github-actions:${env.GITHUB_RUN_ID ?? process.pid}:${env.GITHUB_RUN_ATTEMPT ?? "1"}`
  );
}

function evaluationEnvironment(run: ClaimedEvaluation) {
  const forwardedNames = [
    "DOCKER_HOST",
    "HOME",
    "LANG",
    "LC_ALL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "PATH",
    "TMPDIR",
    "XDG_RUNTIME_DIR",
  ];
  const env: Record<string, string> = {};
  for (const name of forwardedNames) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  env.NO_COLOR = "1";
  env.SKILL_EVAL_LLM_PROVIDER = run.judgeProvider;
  env.SKILL_EVAL_LLM_MODEL = run.judgeModel;
  env.SKILL_EVAL_JUDGE_MODEL = run.judgeModel;
  env.LLM_JUDGE_MODEL = run.judgeModel;
  return env;
}

function pinnedConfigurationMatches(run: ClaimedEvaluation) {
  const config = NVIDIA_SKILL_EVALUATION_CONFIG;
  return (
    run.sourceRepo === config.sourceRepo &&
    run.configKey === NVIDIA_SKILL_EVALUATION_CONFIG_KEY &&
    run.evaluatorRepository === config.evaluatorRepository &&
    run.evaluatorRelease === config.evaluatorRelease &&
    run.evaluatorCommit === config.evaluatorCommit &&
    run.agent === config.agent &&
    run.agentModel === config.agentModel &&
    run.judgeProvider === config.judgeProvider &&
    run.judgeModel === config.judgeModel &&
    run.environment === config.environment &&
    run.attemptsPerCase === config.attemptsPerCase
  );
}

async function verifyEvaluatorCheckout(evaluatorProject: string) {
  const head = await runCommand(["git", "-C", evaluatorProject, "rev-parse", "HEAD"]);
  if (
    head.exitCode !== 0 ||
    head.stdout.trim().toLowerCase() !== NVIDIA_SKILL_EVALUATION_CONFIG.evaluatorCommit
  ) {
    throw new Error("SkillEvaluator checkout does not match the pinned release commit");
  }
  const tags = await runCommand(["git", "-C", evaluatorProject, "tag", "--points-at", "HEAD"]);
  if (
    tags.exitCode !== 0 ||
    !tags.stdout.split(/\r?\n/).includes(NVIDIA_SKILL_EVALUATION_CONFIG.evaluatorRelease)
  ) {
    throw new Error("SkillEvaluator checkout does not contain the pinned release tag");
  }
}

function commandFailure(prefix: string, result: { stdout: string; stderr: string }) {
  const detail = (result.stderr || result.stdout).trim().slice(-4_000);
  return redactWorkerPublicText(`${prefix}${detail ? `: ${detail}` : ""}`, 4_500);
}

async function skipRun(
  client: WorkerClient,
  token: string,
  run: ClaimedEvaluation,
  reason: string,
) {
  await client.action(api.skillEvaluations.skipSkillEvaluation, {
    token,
    runId: run._id,
    leaseToken: run.leaseToken,
    reason,
  });
  logger.info({ event: "skill_evaluation_skipped", runId: run._id }, "skill evaluation skipped");
}

async function failRun(
  client: WorkerClient,
  token: string,
  run: ClaimedEvaluation,
  error: unknown,
) {
  const message = redactWorkerPublicText(
    error instanceof Error ? error.message : String(error),
    2_000,
  );
  const result = await client.action(api.skillEvaluations.failSkillEvaluation, {
    token,
    runId: run._id,
    leaseToken: run.leaseToken,
    error: message,
  });
  logger.error(
    { event: "skill_evaluation_failed", retry: result.retry, runId: run._id },
    "skill evaluation failed",
  );
}

export async function processClaimedEvaluation(args: {
  client: WorkerClient;
  evaluatorProject: string;
  run: ClaimedEvaluation;
  token: string;
}) {
  const { client, evaluatorProject, run, token } = args;
  const startedAt = Date.now();
  let snapshotRoot: string | undefined;
  try {
    if (!pinnedConfigurationMatches(run)) {
      await skipRun(client, token, run, "unsupported-config: worker configuration changed");
      return { outcome: "skipped" as const };
    }

    const snapshot = await materializeNvidiaSkillsSnapshot(run.sourceCommit);
    snapshotRoot = snapshot.root;
    const skillDirectory = resolveRepositoryPath(snapshot.checkout, run.sourcePath);
    const discovery = await discoverSkillEvals(skillDirectory);
    if (discovery.status === "skipped") {
      await skipRun(client, token, run, `${discovery.reason}: ${discovery.message}`);
      return { outcome: "skipped" as const };
    }

    const resultsDirectory = join(snapshot.root, "results");
    const commands = buildTier3Commands({
      evaluatorProject,
      skillDirectory,
      resultsDirectory,
      agent: run.agent,
      agentModel: run.agentModel,
      attempts: run.attemptsPerCase,
      environment: run.environment,
    });
    const env = evaluationEnvironment(run);
    const validation = await runCommand(commands.validate, {
      cwd: snapshot.checkout,
      env,
      timeoutMs: VALIDATION_TIMEOUT_MS,
    });
    if (validation.exitCode !== 0) {
      await skipRun(
        client,
        token,
        run,
        commandFailure("invalid-evals: SkillEvaluator Tier 3 validation failed", validation),
      );
      return { outcome: "skipped" as const };
    }

    logger.info(
      { event: "skill_evaluation_started", runId: run._id },
      "SkillEvaluator Tier 3 run started",
    );
    const evaluation = await runCommand(commands.evaluate, {
      cwd: snapshot.checkout,
      env,
      timeoutMs: EVALUATION_TIMEOUT_MS,
    });
    if (evaluation.exitCode !== 0) {
      throw new Error(commandFailure("SkillEvaluator Tier 3 evaluation failed", evaluation));
    }
    const resultPath = await findLatestResultJson(resultsDirectory);
    if (!resultPath) throw new Error("SkillEvaluator completed without producing result.json");
    const resultJson = await readFile(resultPath, "utf8");
    await client.action(api.skillEvaluations.completeSkillEvaluation, {
      token,
      runId: run._id,
      leaseToken: run.leaseToken,
      resultJson,
      durationMs: Date.now() - startedAt,
      taskSource: discovery.taskSource,
      evalDirectory: relative(snapshot.checkout, discovery.evalDirectory),
      ...(discovery.datasetPath
        ? { evalDatasetPath: relative(snapshot.checkout, discovery.datasetPath) }
        : {}),
      ...(discovery.configPath
        ? { evalConfigPath: relative(snapshot.checkout, discovery.configPath) }
        : {}),
    });
    logger.info(
      { durationMs: Date.now() - startedAt, event: "skill_evaluation_completed", runId: run._id },
      "skill evaluation completed",
    );
    return { outcome: "succeeded" as const };
  } catch (error) {
    await failRun(client, token, run, error);
    return { outcome: "failed" as const };
  } finally {
    if (snapshotRoot) await rm(snapshotRoot, { force: true, recursive: true });
  }
}

export async function runSkillEvaluationWorker(options?: {
  client?: WorkerClient;
  evaluatorProject?: string;
  token?: string;
  workerId?: string;
}) {
  maskKnownWorkerSecrets();
  const convexUrl = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (!options?.client && !convexUrl) throw new Error("CONVEX_URL or VITE_CONVEX_URL is required");
  const client = options?.client ?? new ConvexHttpClient(convexUrl as string);
  const token = options?.token ?? requireEnv("SECURITY_SCAN_WORKER_TOKEN");
  const evaluatorProject = resolve(options?.evaluatorProject ?? requireEnv("SKILL_EVALUATOR_DIR"));
  await verifyEvaluatorCheckout(evaluatorProject);
  const claimed = await client.action(api.skillEvaluations.claimSkillEvaluationJobs, {
    token,
    workerId: options?.workerId ?? workerId(),
    limit: 1,
    leaseMs: 3 * 60 * 60 * 1000,
  });
  const run = claimed[0] as ClaimedEvaluation | undefined;
  if (!run) {
    logger.info({ event: "skill_evaluation_queue_empty" }, "no skill evaluation jobs available");
    return { claimed: 0, failed: 0 };
  }
  const result = await processClaimedEvaluation({ client, evaluatorProject, run, token });
  return { claimed: 1, failed: result.outcome === "failed" ? 1 : 0 };
}

if (import.meta.main) {
  const result = await runSkillEvaluationWorker();
  if (result.failed > 0) process.exitCode = 1;
}
