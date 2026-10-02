import { spawn } from "node:child_process";

const DEFAULT_MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 1024 * 1024;

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
    timeoutMs: number;
  },
) {
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
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = { stdout: "", stderr: "" };
    const outputBytes = { stdout: 0, stderr: 0 };
    let outputLimitExceeded: "stdout" | "stderr" | undefined;
    let timedOut = false;
    let settled = false;
    let forceKillTimeout: NodeJS.Timeout | undefined;
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
      killProcessTree("SIGTERM");
      forceKillTimeout = setTimeout(() => killProcessTree("SIGKILL"), 10_000);
      forceKillTimeout.unref();
    };
    const appendOutput = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (outputLimitExceeded) return;
      const maxBytes = stream === "stdout" ? maxStdoutBytes : maxStderrBytes;
      const remaining = Math.max(0, maxBytes - outputBytes[stream]);
      const accepted = chunk.subarray(0, remaining);
      output[stream] += accepted.toString("utf8");
      outputBytes[stream] += accepted.byteLength;
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
    };
    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (timedOut) killProcessTree("SIGKILL");
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (timedOut || outputLimitExceeded) killProcessTree("SIGKILL");
      const label = options.commandLabel ?? command;
      if (outputLimitExceeded) {
        const maxBytes =
          outputLimitExceeded === "stdout" ? options.maxStdoutBytes : options.maxStderrBytes;
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
