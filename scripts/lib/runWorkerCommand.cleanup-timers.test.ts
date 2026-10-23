/* @vitest-environment node */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { runWorkerCommand, type WorkerCommandTermination } from "./runWorkerCommand";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
const fixturePid = 2_147_000_000;

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", platformDescriptor);
});

function simulatedChild() {
  const child = Object.assign(new EventEmitter(), {
    pid: fixturePid,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    unref: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}

it.skipIf(process.platform === "win32").each(["present", "permission_denied"])(
  "keeps cleanup unknown within the original 60-second allowance when the group is %s",
  async (state) => {
    vi.useFakeTimers();
    const child = simulatedChild();
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      expect(pid).toBe(-fixturePid);
      if (signal === 0 && state === "permission_denied")
        throw Object.assign(new Error("denied"), { code: "EPERM" });
      return true;
    });
    const onTermination = vi.fn();
    const pending = runWorkerCommand("generated", [], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 100,
      cleanupProcessGroup: true,
      onTermination,
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    child.emit("close", null);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(onTermination).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ timedOut: true });
    expect(onTermination).toHaveBeenCalledExactlyOnceWith({
      elapsedMs: 60_100,
      cleanupMs: 60_000,
      processGroup: "unknown",
      exitCode: null,
      timedOut: true,
      outputLimitExceeded: null,
    });
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.skipIf(process.platform === "win32").each([-1_000_000, 1_000_000])(
  "retains the elapsed cleanup deadline across late close and a %i ms wall-clock adjustment",
  async (wallClockAdjustment) => {
    vi.useFakeTimers();
    const child = simulatedChild();
    vi.spyOn(process, "kill").mockImplementation((pid) => {
      expect(pid).toBe(-fixturePid);
      return true;
    });
    const onTermination = vi.fn();
    const pending = runWorkerCommand("generated", [], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 100,
      cleanupProcessGroup: true,
      onTermination,
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(20_000);
    child.emit("close", null);
    vi.setSystemTime(Date.now() + wallClockAdjustment);
    await vi.advanceTimersByTimeAsync(25);
    expect(onTermination).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(39_974);
    expect(onTermination).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTermination).toHaveBeenCalledExactlyOnceWith({
      elapsedMs: 60_100,
      cleanupMs: 60_000,
      processGroup: "unknown",
      exitCode: null,
      timedOut: true,
      outputLimitExceeded: null,
    });
    expect(await pending).toMatchObject({
      timedOut: true,
      message: "Worker cleanup could not be confirmed",
    });
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.skipIf(process.platform === "win32").each([-1_000_000, 1_000_000])(
  "confirms successful cleanup after a %i ms wall-clock adjustment without advancing Date",
  async (wallClockAdjustment) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const child = simulatedChild();
    let groupAbsent = false;
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      expect(pid).toBe(-fixturePid);
      if (signal === 0 && groupAbsent) throw Object.assign(new Error("absent"), { code: "ESRCH" });
      return true;
    });
    const onTermination = vi.fn();
    const pending = runWorkerCommand("generated", [], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 100,
      cleanupProcessGroup: true,
      onTermination,
    });
    await vi.advanceTimersByTimeAsync(75);
    child.emit("close", 0);
    wallClock.mockReturnValue(1_000_000 + wallClockAdjustment);
    await vi.advanceTimersByTimeAsync(24);
    expect(onTermination).not.toHaveBeenCalled();
    groupAbsent = true;
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ stdout: "", stderr: "" });
    expect(onTermination).toHaveBeenCalledExactlyOnceWith({
      elapsedMs: 100,
      cleanupMs: 25,
      processGroup: "absent",
      exitCode: 0,
      timedOut: false,
      outputLimitExceeded: null,
    });
    expect(Date.now()).toBe(1_000_000 + wallClockAdjustment);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("reports whole elapsed milliseconds from a high-resolution clock", async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockReturnValueOnce(100.25).mockReturnValue(125.75);
  const child = simulatedChild();
  const onTermination = vi.fn();
  const pending = runWorkerCommand("generated", [], {
    cwd: tmpdir(),
    env: {},
    timeoutMs: 100,
    onTermination,
  });
  child.emit("close", 0);
  await expect(pending).resolves.toEqual({ stdout: "", stderr: "" });
  expect(onTermination).toHaveBeenCalledWith(
    expect.objectContaining({ elapsedMs: 25, cleanupMs: 0, timedOut: false }),
  );
  expect(vi.getTimerCount()).toBe(0);
});

it.skipIf(process.platform === "win32")(
  "does not relabel a completed command as timed out during cleanup verification",
  async () => {
    vi.useFakeTimers();
    const child = simulatedChild();
    let probes = 0;
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      expect(pid).toBe(-fixturePid);
      if (signal === 0 && ++probes > 1) throw Object.assign(new Error("absent"), { code: "ESRCH" });
      return true;
    });
    let termination: WorkerCommandTermination | undefined;
    const pending = runWorkerCommand("generated", [], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 10,
      cleanupProcessGroup: true,
      onTermination: (value) => {
        termination = value;
      },
    });
    child.emit("close", 0);
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toEqual({ stdout: "", stderr: "" });
    expect(termination).toMatchObject({ timedOut: false, processGroup: "absent", cleanupMs: 25 });
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.skipIf(process.platform === "win32").each([-1_000_000, 1_000_000])(
  "retains force-kill and unclosed-pipe deadlines after a %i ms wall-clock adjustment",
  async (wallClockAdjustment) => {
    vi.useFakeTimers();
    const child = simulatedChild();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const onTermination = vi.fn();
    const pending = runWorkerCommand("generated", [], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 100,
      cleanupProcessGroup: true,
      onTermination,
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(kill).toHaveBeenCalledWith(-fixturePid, "SIGTERM");
    await vi.advanceTimersByTimeAsync(9_999);
    expect(kill).not.toHaveBeenCalledWith(-fixturePid, "SIGKILL");
    await vi.advanceTimersByTimeAsync(1);
    expect(kill).toHaveBeenCalledWith(-fixturePid, "SIGKILL");
    vi.setSystemTime(Date.now() + wallClockAdjustment);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(await pending).toMatchObject({
      timedOut: true,
      message: "Worker cleanup could not be confirmed",
    });
    expect(onTermination).toHaveBeenCalledWith(
      expect.objectContaining({ processGroup: "unknown", cleanupMs: 60_000 }),
    );
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(child.unref).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("does not claim Windows process-group absence from direct child termination", async () => {
  vi.useFakeTimers();
  Object.defineProperty(process, "platform", { value: "win32" });
  const child = simulatedChild();
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  const onTermination = vi.fn();
  const pending = runWorkerCommand("generated", [], {
    cwd: tmpdir(),
    env: {},
    timeoutMs: 100,
    cleanupProcessGroup: true,
    onTermination,
  }).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(100);
  child.emit("close", null);
  expect(await pending).toMatchObject({ timedOut: true });
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  expect(kill).not.toHaveBeenCalled();
  expect(onTermination).toHaveBeenCalledWith(
    expect.objectContaining({ processGroup: "unknown", timedOut: true }),
  );
  expect(vi.getTimerCount()).toBe(0);
});
