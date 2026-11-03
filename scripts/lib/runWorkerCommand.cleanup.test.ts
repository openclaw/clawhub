/* @vitest-environment node */
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import {
  CommandFailure,
  runWorkerCommand,
  type WorkerCommandTermination,
} from "./runWorkerCommand";

it
  .skipIf(process.platform === "win32")
  .each([
    "timeout",
    "inherited_pipes",
    "leader_exit",
    "nonzero_exit",
    "output_limit",
    "observer_failure",
  ])("confirms descendant group absence after %s", async (trigger) => {
  const shouldTimeout = trigger === "timeout" || trigger === "inherited_pipes";
  let groupPid: number | undefined;
  let termination: WorkerCommandTermination | undefined;
  try {
    const failure = await runWorkerCommand(
      process.execPath,
      [
        "-e",
        `
          const { spawn } = require('node:child_process');
          const descendant = spawn(process.execPath, ['-e', \
            "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"], \
            { stdio: ${JSON.stringify(trigger)} === 'inherited_pipes'
              ? ['ignore', 'inherit', 'inherit', 'ipc']
              : ['ignore', 'ignore', 'ignore', 'ipc'] });
          descendant.on('message', () => {
            process.stderr.write(String(process.pid));
            if (${JSON.stringify(trigger)} === 'leader_exit') process.exit(0);
            if (${JSON.stringify(trigger)} === 'nonzero_exit') process.exit(7);
            if (${JSON.stringify(trigger)} === 'output_limit') process.stdout.write('x'.repeat(256));
          });
          setInterval(() => {}, 1000);
          `,
      ],
      {
        cwd: tmpdir(),
        env: {},
        timeoutMs: 1200,
        captureOutput: false,
        maxStdoutBytes: 128,
        cleanupProcessGroup: true,
        onStderrChunk: (chunk) => {
          groupPid = Number(chunk.toString());
          if (trigger === "observer_failure") throw new Error("PRIVATE observer failure");
        },
        onTermination: (value) => {
          termination = value;
        },
      },
    ).catch((error: unknown) => error);
    if (trigger === "leader_exit") expect(failure).toEqual({ stdout: "", stderr: "" });
    else {
      expect(failure).toBeInstanceOf(CommandFailure);
      expect(failure).toMatchObject({ timedOut: shouldTimeout });
      if (trigger === "nonzero_exit") expect(failure).toMatchObject({ exitCode: 7 });
      if (trigger === "output_limit")
        expect(failure).toMatchObject({ outputLimitExceeded: "stdout" });
      if (trigger === "observer_failure")
        expect(failure).toMatchObject({ message: "Worker diagnostic observer failed" });
    }
    expect(groupPid).toBeGreaterThan(0);
    await expect
      .poll(() => {
        try {
          process.kill(-groupPid!, 0);
          return false;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "ESRCH";
        }
      })
      .toBe(true);
    expect(termination).toMatchObject({
      timedOut: shouldTimeout,
      processGroup: "absent",
    });
    expect(termination!.cleanupMs).toBeLessThan(60_000);
  } finally {
    if (groupPid) {
      try {
        process.kill(-groupPid, "SIGKILL");
      } catch {}
    }
  }
});

it("reports spawn failure without waiting for a nonexistent group", async () => {
  let termination: WorkerCommandTermination | undefined;
  await expect(
    runWorkerCommand("/nonexistent-generated-worker-command", [], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 1200,
      cleanupProcessGroup: true,
      onTermination: (value) => {
        termination = value;
      },
    }),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(termination).toMatchObject({ processGroup: "unknown", timedOut: false, cleanupMs: 0 });
});
