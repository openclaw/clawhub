import { spawn } from "node:child_process";

const DEFAULT_MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 1024 * 1024;

export type WorkerCommandTermination = {
  elapsedMs: number;
  cleanupMs: number;
  processGroup: "absent" | "unknown";
  exitCode: number | null;
  timedOut: boolean;
  outputLimitExceeded: "stdout" | "stderr" | null;
};

export class CommandFailure extends Error {
  exitCode: number | null;
  outputLimitExceeded?: "stdout" | "stderr";
  stderr: string;
  stdout: string;
  timedOut: boolean;

  constructor(
    message: string,
    exitCode: number | null,
    stdout: string,
    stderr: string,
    timedOut: boolean,
    outputLimitExceeded?: "stdout" | "stderr",
  ) {
    super(message);
    this.name = "CommandFailure";
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
    this.timedOut = timedOut;
    this.outputLimitExceeded = outputLimitExceeded;
  }
}

export async function runWorkerCommand(
  command: string,
  args: string[],
  options: {
    commandLabel?: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    input?: string;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    captureOutput?: boolean;
    /** Drain raw diagnostics without retaining them or applying a stderr byte cap. */
    discardStderr?: boolean;
    cleanupProcessGroup?: boolean;
    onStderrChunk?: (chunk: Buffer) => void;
    onTermination?: (termination: WorkerCommandTermination) => void;
    timeoutMs: number;
  },
) {
  if (options.discardStderr && options.onStderrChunk) {
    throw new RangeError("Cannot discard observed stderr");
  }
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
  for (const [stream, limit] of [
    ["stdout", maxStdoutBytes],
    ["stderr", maxStderrBytes],
  ] as const) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError(`${stream} output limit must be a non-negative safe integer`);
    }
  }
  return await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const startedAt = performance.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = { stdout: "", stderr: "" };
    const outputBytes = { stdout: 0, stderr: 0 };
    let outputLimitExceeded: "stdout" | "stderr" | undefined;
    let observerFailed = false;
    let timedOut = false;
    let settled = false;
    let forceKillTimeout: NodeJS.Timeout | undefined;
    let cleanupTimeout: NodeJS.Timeout | undefined;
    let cleanupStartedAt: number | undefined;
    const processGroupState = (): "absent" | "unknown" => {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return "absent";
        }
      }
      return "unknown";
    };
    const reportTermination = (exitCode: number | null, processGroup = processGroupState()) => {
      const finishedAt = performance.now();
      options.onTermination?.({
        elapsedMs: Math.floor(finishedAt - startedAt),
        cleanupMs: cleanupStartedAt === undefined ? 0 : Math.floor(finishedAt - cleanupStartedAt),
        processGroup,
        exitCode,
        timedOut,
        outputLimitExceeded: outputLimitExceeded ?? null,
      });
    };
    const killProcessTree = (signal: NodeJS.Signals) => {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The process group may already have exited; fall back to the direct child.
        }
      }
      child.kill(signal);
    };
    const terminateProcessTree = () => {
      if (forceKillTimeout) return;
      cleanupStartedAt = performance.now();
      killProcessTree("SIGTERM");
      forceKillTimeout = setTimeout(() => killProcessTree("SIGKILL"), 10_000);
      forceKillTimeout.unref();
      cleanupTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        killProcessTree("SIGKILL");
        clearTimers();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        reportTermination(null);
        reject(
          new CommandFailure(
            "Worker cleanup could not be confirmed",
            null,
            output.stdout,
            output.stderr,
            timedOut,
            outputLimitExceeded,
          ),
        );
      }, 60_000);
    };
    const appendOutput = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (stream === "stderr" && options.discardStderr) return;
      if (outputLimitExceeded) return;
      const maxBytes = stream === "stdout" ? maxStdoutBytes : maxStderrBytes;
      const remaining = Math.max(0, maxBytes - outputBytes[stream]);
      const accepted = chunk.subarray(0, remaining);
      if (options.captureOutput !== false) output[stream] += accepted.toString("utf8");
      outputBytes[stream] += accepted.byteLength;
      if (stream === "stderr" && accepted.byteLength && !observerFailed) {
        try {
          options.onStderrChunk?.(accepted);
        } catch {
          observerFailed = true;
          terminateProcessTree();
        }
      }
      if (accepted.byteLength < chunk.byteLength) {
        outputLimitExceeded = stream;
        terminateProcessTree();
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree();
    }, options.timeoutMs);
    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      if (cleanupTimeout) clearTimeout(cleanupTimeout);
    };
    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (timedOut) killProcessTree("SIGKILL");
      reportTermination(null);
      reject(error);
    });
    child.on("close", async (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      const cleanupRequired =
        timedOut || outputLimitExceeded || observerFailed || options.cleanupProcessGroup;
      if (cleanupRequired) {
        cleanupStartedAt ??= performance.now();
        killProcessTree("SIGKILL");
        if (process.platform !== "win32" && child.pid) {
          await new Promise<void>((resolveCleanup) => {
            const check = () => {
              const remainingMs = cleanupStartedAt! + 60_000 - performance.now();
              if (processGroupState() === "absent" || remainingMs <= 0) {
                resolveCleanup();
                return;
              }
              setTimeout(check, Math.min(25, remainingMs));
            };
            check();
          });
        }
      }
      const processGroup = processGroupState();
      reportTermination(code, processGroup);
      const label = options.commandLabel ?? command;
      if (observerFailed) {
        reject(
          new CommandFailure(
            "Worker diagnostic observer failed",
            code,
            output.stdout,
            output.stderr,
            timedOut,
          ),
        );
        return;
      }
      if (outputLimitExceeded) {
        const maxBytes = outputLimitExceeded === "stdout" ? maxStdoutBytes : maxStderrBytes;
        reject(
          new CommandFailure(
            `${label} ${outputLimitExceeded} exceeded the ${maxBytes} byte output limit; see redacted stdout/stderr diagnostics`,
            code,
            output.stdout,
            output.stderr,
            timedOut,
            outputLimitExceeded,
          ),
        );
        return;
      }
      if (cleanupRequired && process.platform !== "win32" && processGroup !== "absent") {
        reject(
          new CommandFailure(
            "Worker cleanup could not be confirmed",
            code,
            output.stdout,
            output.stderr,
            timedOut,
          ),
        );
        return;
      }
      if (code === 0 && !timedOut) {
        resolvePromise(output);
        return;
      }
      reject(
        new CommandFailure(
          `${label} ${timedOut ? "timed out" : `exited ${code}`}; see redacted stdout/stderr diagnostics`,
          code,
          output.stdout,
          output.stderr,
          timedOut,
        ),
      );
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
