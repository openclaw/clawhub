/* @vitest-environment node */
import { getEventListeners } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runWorkerCommand } from "./runWorkerCommand";

it("does not launch work that was cancelled before admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "worker-preabort-"));
  try {
    const marker = join(root, "spawned");
    const controller = new AbortController();
    controller.abort();
    const onTermination = vi.fn();
    await expect(
      runWorkerCommand(
        process.execPath,
        ["-e", "require('node:fs').writeFileSync(process.argv[1], 'ran')", marker],
        { cwd: root, env: {}, timeoutMs: 1000, signal: controller.signal, onTermination },
      ),
    ).rejects.toMatchObject({ message: "Worker command cancelled", failureKind: "cancelled" });
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(onTermination).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("removes the cancellation listener when ordinary work finishes", async () => {
  const controller = new AbortController();
  await expect(
    runWorkerCommand(process.execPath, ["-e", "process.stdout.write('finished')"], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 1000,
      signal: controller.signal,
      cleanupProcessGroup: true,
    }),
  ).resolves.toEqual({ stdout: "finished", stderr: "" });
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  controller.abort();
});
