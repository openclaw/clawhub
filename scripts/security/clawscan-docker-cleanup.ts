import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  CommandFailure,
  runWorkerCommand,
  type WorkerCommandTermination,
} from "../lib/runWorkerCommand";

const RUN_ID_ENV = "CLAWSCAN_SANDBOX_RUN_ID";
const RUN_ID_LABEL = "org.openclaw.clawscan.run-id";
const COMMAND_ID_LABEL = "org.openclaw.clawscan.command-id";
const CLEANUP_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;
const MAX_DIAGNOSTIC_BYTES = 128 * 1024;
const CONTAINER_ID = /^[a-f0-9]{64}$/;
// The qualified native source uses crypto/rand.Text (26 base32 characters).
const COMMAND_ID = /^[A-Z2-7]{26}$/;
const INSPECT_FORMAT =
  "{{ .Id }}\n{{ index .Config.Labels " +
  JSON.stringify(RUN_ID_LABEL) +
  " }}\n{{ index .Config.Labels " +
  JSON.stringify(COMMAND_ID_LABEL) +
  " }}";

// Optional overview failure is contained by native ClawScan, so host exit 0
// alone cannot certify that every daemon create finished. This custody decision
// is independent of the stored Decisions verdict or optional overview prose.
export function hasKnownClawScanChildFinality(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Record<string, unknown>;
  if (
    run.schemaVersion !== "clawscan-run-v1" ||
    run.status !== "completed" ||
    run.complete !== true
  )
    return false;
  if (run.overview === undefined) return true;
  if (!run.overview || typeof run.overview !== "object" || Array.isArray(run.overview))
    return false;
  const overview = run.overview as Record<string, unknown>;
  if (overview.commandStarted !== undefined && typeof overview.commandStarted !== "boolean")
    return false;
  if (overview.commandStarted === false) return true;
  return overview.status === "completed" && overview.error === "";
}

export class ClawScanContainerCleanupError extends Error {
  readonly preserveWorkspace = true;
  readonly workerMustStop = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ClawScanContainerCleanupError";
  }
}

function cleanupEnv(workspace: string, source: NodeJS.ProcessEnv) {
  const env: NodeJS.ProcessEnv = {
    NO_COLOR: "1",
    TEMP: workspace,
    TMP: workspace,
    TMPDIR: workspace,
  };
  // Preserve the caller's Docker destination, without forwarding scanner credentials.
  for (const key of [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "DOCKER_CONFIG",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "DOCKER_API_VERSION",
  ]) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

function objectMissing(error: unknown, id: string) {
  if (
    !(error instanceof CommandFailure) ||
    error.exitCode !== 1 ||
    error.timedOut ||
    error.outputLimitExceeded ||
    error.stdout.trim()
  )
    return false;
  // Only an authoritative missing response for this exact immutable ID counts.
  return [
    "Error: No such object: " + id,
    "Error: No such container: " + id,
    "Error response from daemon: No such container: " + id,
    "Error response from daemon: No such object: " + id,
  ].includes(error.stderr.trim());
}

function cleanupBounds(timeoutMs: number, pollIntervalMs: number) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > CLEANUP_TIMEOUT_MS ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 1 ||
    pollIntervalMs > 1_000
  ) {
    throw new RangeError("Invalid bounded ClawScan Docker cleanup timing");
  }
}

async function cleanupRun(input: {
  workspace: string;
  env: NodeJS.ProcessEnv;
  runId: string;
  normalCompletion: boolean;
  timeoutMs: number;
  pollIntervalMs: number;
}) {
  const deadline = performance.now() + input.timeoutMs;
  const env = cleanupEnv(input.workspace, input.env);
  const remaining = () => {
    const ms = Math.floor(deadline - performance.now());
    if (ms <= 0) throw new Error("ClawScan Docker cleanup deadline exceeded");
    return ms;
  };
  const runDocker = async (args: string[]) => {
    const timeoutMs = remaining();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // The shared process helper still owns terminating/reaping a timed-out CLI.
      // Stop this sweep at its own deadline even if local process finality is unknown.
      const command = runWorkerCommand("docker", args, {
        commandLabel: "ClawScan Docker cleanup",
        cwd: input.workspace,
        env,
        timeoutMs,
        maxStdoutBytes: MAX_DIAGNOSTIC_BYTES,
        maxStderrBytes: MAX_DIAGNOSTIC_BYTES,
        cleanupProcessGroup: true,
      });
      const result = await Promise.race([
        command,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("ClawScan Docker cleanup deadline exceeded")),
            timeoutMs,
          );
        }),
      ]);
      remaining();
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const list = async () => {
    const result = await runDocker([
      "container",
      "ls",
      "--all",
      "--quiet",
      "--no-trunc",
      "--filter",
      "label=" + RUN_ID_LABEL + "=" + input.runId,
    ]);
    const ids = result.stdout.trim() ? result.stdout.trim().split(/\s+/) : [];
    if (ids.some((id) => !CONTAINER_ID.test(id))) {
      throw new Error("Docker returned a non-immutable ClawScan container ID");
    }
    return [...new Set(ids)];
  };
  const inspectedCommands = new Map<string, string>();
  const inspect = async (id: string) => {
    let output;
    try {
      output = await runDocker(["container", "inspect", "--format", INSPECT_FORMAT, id]);
    } catch (error) {
      if (objectMissing(error, id)) return false;
      throw error;
    }
    const [actualId, runId, commandId, ...extra] = output.stdout.trim().split("\n");
    const previousCommand = inspectedCommands.get(id);
    if (
      actualId !== id ||
      runId !== input.runId ||
      !commandId ||
      !COMMAND_ID.test(commandId) ||
      extra.length ||
      (previousCommand !== undefined && previousCommand !== commandId)
    ) {
      throw new Error("Refusing to remove ClawScan container: ownership does not match");
    }
    inspectedCommands.set(id, commandId);
    return true;
  };
  const remove = async (id: string) => {
    if (!(await inspect(id))) return;
    try {
      await runDocker(["container", "rm", "--force", "--volumes", id]);
    } catch (error) {
      if (!objectMissing(error, id)) throw error;
    }
    if (await inspect(id)) throw new Error("Removed ClawScan container is still present");
  };

  while (true) {
    const ids = await list();
    const failures: unknown[] = [];
    for (const id of ids) {
      try {
        await remove(id);
      } catch (error) {
        failures.push(error);
      }
    }
    // One bad candidate must not prevent cleanup of independently verified siblings.
    if (failures.length)
      throw new AggregateError(failures, "ClawScan container removal unconfirmed");
    if (input.normalCompletion) {
      if ((await list()).length === 0) return;
    }
    // Cancellation can leave multiple create requests pending in the daemon. Neither
    // one removed container nor an empty poll proves that those requests are done.
    // Sweep the full bounded window, then fail closed: Docker provides no barrier
    // that confirms cancellation of all unseen creates for a run label.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(input.pollIntervalMs, remaining())),
    );
  }
}

/**
 * The callback must await the host command through runWorkerCommand, forward its
 * onTermination event, and use the supplied env (never mutate process.env).
 * Callers MUST preserve the workspace and stop claiming on the distinct cleanup
 * error. Failed/cancelled/unknown host completion cannot prove daemon finality.
 */
export async function withClawScanDockerCleanup<T>(input: {
  workspace: string;
  env: NodeJS.ProcessEnv;
  run: (
    env: NodeJS.ProcessEnv,
    onTermination: (event: WorkerCommandTermination) => void,
  ) => Promise<T>;
  confirmChildFinality?: (result: T) => Promise<boolean>;
  cleanupTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<T> {
  const timeoutMs = input.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? POLL_INTERVAL_MS;
  cleanupBounds(timeoutMs, pollIntervalMs);
  const runId = randomUUID();
  const env = { ...input.env, [RUN_ID_ENV]: runId };
  let termination: WorkerCommandTermination | undefined;
  let result: T | undefined;
  let commandError: unknown;
  let completed = false;
  try {
    result = await input.run(env, (event) => {
      termination = { ...event };
    });
    completed = true;
  } catch (error) {
    commandError = error;
  }
  let childFinalityKnown = false;
  if (completed && input.confirmChildFinality) {
    try {
      childFinalityKnown = await input.confirmChildFinality(result as T);
    } catch {
      /* Unknown stays fail-closed. */
    }
  }
  const normalCompletion =
    completed &&
    childFinalityKnown &&
    termination?.processGroup === "absent" &&
    termination.exitCode === 0 &&
    !termination.timedOut &&
    termination.outputLimitExceeded === null;
  try {
    await cleanupRun({
      workspace: input.workspace,
      env,
      runId,
      normalCompletion,
      timeoutMs,
      pollIntervalMs,
    });
  } catch (cleanupError) {
    throw new ClawScanContainerCleanupError(
      "ClawScan Docker cleanup could not be confirmed; preserve workspace and stop worker",
      { cause: completed ? cleanupError : new AggregateError([commandError, cleanupError]) },
    );
  }
  if (!completed) throw commandError;
  return result as T;
}
