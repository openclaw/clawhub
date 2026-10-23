/* @vitest-environment node */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CommandFailure, runWorkerCommand } from "./runWorkerCommand";

it("delivers stderr incrementally and keeps diagnostic capture optional across group timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "diagnostic-group-test-"));
  const pidPath = join(root, "pid");
  const chunks: string[] = [];
  let beforeExit = false;
  try {
    const pending = runWorkerCommand(
      process.execPath,
      [
        "-e",
        `
      const {spawn} = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
      require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
      process.stderr.write('synthetic-live-event\\n');
      process.stdout.write('private-raw-output');
      setInterval(() => {}, 1000);
    `,
      ],
      {
        cwd: root,
        env: {},
        timeoutMs: 1200,
        captureOutput: false,
        onStderrChunk: (chunk) => {
          chunks.push(chunk.toString());
          beforeExit = true;
        },
      },
    );
    const error = await pending.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(CommandFailure);
    expect(error).toMatchObject({ timedOut: true, stdout: "", stderr: "" });
    expect(beforeExit).toBe(true);
    expect(chunks.join("")).toBe("synthetic-live-event\n");
    const grandchild = Number(await readFile(pidPath, "utf8"));
    await expect
      .poll(() => {
        try {
          process.kill(grandchild, 0);
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("terminates instead of throwing raw observer errors out of the stream handler", async () => {
  await expect(
    runWorkerCommand(
      process.execPath,
      ["-e", "process.stderr.write('PRIVATE');setInterval(()=>{},1000)"],
      {
        cwd: tmpdir(),
        env: {},
        timeoutMs: 2000,
        captureOutput: false,
        onStderrChunk: () => {
          throw new Error("PRIVATE observer error");
        },
      },
    ),
  ).rejects.toMatchObject({ message: "Worker diagnostic observer failed", stdout: "", stderr: "" });
});
