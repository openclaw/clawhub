import { spawn } from "node:child_process";

export class CommandFailure extends Error {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;

  constructor(
    message: string,
    exitCode: number | null,
    stdout: string,
    stderr: string,
    timedOut: boolean,
  ) {
    super(message);
    this.name = "CommandFailure";
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
    this.timedOut = timedOut;
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
    timeoutMs: number;
  },
) {
  return await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
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
    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree("SIGTERM");
      forceKillTimeout = setTimeout(() => killProcessTree("SIGKILL"), 10_000);
      forceKillTimeout.unref();
    }, options.timeoutMs);
    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
    };
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
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
      if (timedOut) killProcessTree("SIGKILL");
      if (code === 0 && !timedOut) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const label = options.commandLabel ?? command;
      reject(
        new CommandFailure(
          `${label} ${timedOut ? "timed out" : `exited ${code}`}; see redacted stdout/stderr diagnostics`,
          code,
          stdout,
          stderr,
          timedOut,
        ),
      );
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
