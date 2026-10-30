/* @vitest-environment node */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({ calls: 0, leakedEnvironment: false, scannerCommit: "" }));
vi.mock("./fixtures/solaris-069-bundled.json", async () => {
  const { createHash } = await import("node:crypto");
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const files = [{ path: "skills/control/SKILL.md", size: 7, sha256: hash("control") }];
  return {
    default: {
      archiveSha256: "a".repeat(64),
      manifestSha256: hash(JSON.stringify(files)),
      manifestCanonicalization: "path,size,sha256",
      files,
      bundledRoots: ["skills/control"],
    },
  };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof readFile>) =>
      args[0] === "/etc/os-release"
        ? Promise.resolve('VERSION_ID="22.04"\n')
        : actual.readFile(...args),
  };
});
vi.mock("../lib/runWorkerCommand", async (original) => {
  const actual = await original<typeof import("../lib/runWorkerCommand")>();
  return {
    ...actual,
    runWorkerCommand: async (
      command: string,
      args: string[],
      options: { cwd: string; env: NodeJS.ProcessEnv; onTermination?: (value: unknown) => void },
    ) => {
      if (command === "git") {
        return {
          stdout: args.includes("HEAD:harnesses/openclaw")
            ? "f197f4566f8a3c11755bc6688ec92a2c3347b4dd\nbcf058341b9cfa6290525a3980eab50e6b4b356f\n"
            : args.includes("status")
              ? ""
              : `${probe.scannerCommit}\n`,
          stderr: "",
        };
      }
      if (command === "python") return { stdout: "Python 3.12.16\n", stderr: "" };
      if (command === "node") return { stdout: "v24.22.1\n", stderr: "" };
      if (command !== "skillspector") throw new Error("Unexpected command");
      probe.calls++;
      probe.leakedEnvironment = [
        "SECURITY_SCAN_WORKER_TOKEN",
        "GITHUB_TOKEN",
        "CONVEX_DEPLOY_KEY",
        "GH_TOKEN",
      ].some((name) => name in options.env);
      expect(options.env.OPENAI_API_KEY).toBe("PRIVATE_API_KEY");
      expect(options.env.SKILLSPECTOR_PROVIDER).toBe("openai");
      expect(options.env.SKILLSPECTOR_MODEL).toBe("gpt-6.1-sol");
      const path = args[args.indexOf("--output") + 1];
      await writeFile(
        path,
        JSON.stringify({
          execution_successful: false,
          secret: "PRIVATE_REPORT",
          analysis_completeness: {
            status: "failed",
            ledger_exceptions: [
              {
                reason_code: "analyzer_runtime_error",
                error_class: "RateLimitError",
                path: "PRIVATE_PATH",
                error: "PRIVATE_ERROR",
              },
            ],
          },
        }),
      );
      options.onTermination?.({
        elapsedMs: 25,
        cleanupMs: 0,
        processGroup: "absent",
        exitCode: 2,
        timedOut: false,
        outputLimitExceeded: null,
      });
      throw new actual.CommandFailure(
        "PRIVATE_COMMAND",
        2,
        "PRIVATE_STDOUT",
        "PRIVATE_STDERR",
        false,
      );
    },
  };
});
import { main } from "./solaris-bundled-diagnostic";

const roots: string[] = [];
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(async () => {
  Object.defineProperty(process, "platform", platform);
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(corrupt = false) {
  probe.calls = 0;
  probe.leakedEnvironment = false;
  probe.scannerCommit = (
    await readFile(new URL("./clawscan-source-commit.txt", import.meta.url), "utf8")
  ).trim();
  const root = await mkdtemp(join(tmpdir(), "solaris-diagnostic-test-"));
  roots.push(root);
  const source = join(root, "solaris-source/harnesses/openclaw/skills/control");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), corrupt ? "changed" : "control");
  const scanner = join(root, "scanner");
  await mkdir(join(scanner, "docker/clawscan-runtime"), { recursive: true });
  await writeFile(
    join(scanner, "docker/clawscan-runtime/Dockerfile"),
    `ARG SKILLSPECTOR_REF=${"b".repeat(40)}\n`,
  );
  await mkdir(join(root, "temp"));
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_OS: "Linux",
    RUNNER_ARCH: "X64",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    CLAWSCAN_DIAGNOSTIC_RUNNER: "ubuntu-22.04",
    RUNNER_TEMP: join(root, "temp"),
    GITHUB_WORKSPACE: root,
    GITHUB_OUTPUT: join(root, "output"),
    CLAWSCAN_SOURCE_DIR: scanner,
    OPENAI_API_KEY: "PRIVATE_API_KEY",
    DEFAULT_BASE_URL: "https://api.openai.com/v1",
    DEFAULT_MODEL: "gpt-6.1-sol",
    REASONING_EFFORT: "medium",
    SKILLSPECTOR_PROVIDER: "openai",
    SKILLSPECTOR_MODEL: "gpt-6.1-sol",
    SKILLSPECTOR_REASONING_EFFORT: "medium",
    SECURITY_SCAN_WORKER_TOKEN: "PRIVATE_WORKER",
    GITHUB_TOKEN: "PRIVATE_GITHUB",
    CONVEX_DEPLOY_KEY: "PRIVATE_CONVEX",
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("SKILLSPECTOR_SERVICE_TIER", undefined);
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  return root;
}

it("uses the real bundled helper, retains only safe failed-child evidence and removes private scratch", async () => {
  const root = await setup();
  await main([]);
  expect(probe.calls).toBe(1);
  expect(probe.leakedEnvironment).toBe(false);
  expect(process.env.SECURITY_SCAN_WORKER_TOKEN).toBe("PRIVATE_WORKER");
  const output = (await readFile(join(root, "output"), "utf8")).trim().split("=")[1];
  const raw = await readFile(join(output, "summary.json"), "utf8");
  expect(raw).not.toContain("PRIVATE");
  const summary = JSON.parse(raw);
  expect(summary).toMatchObject({
    status: "failed",
    cleanup: true,
    before: { files: 1, bytes: 7 },
    after: { files: 1, bytes: 7 },
    failure: {
      exitCode: 2,
      timedOut: false,
      context: {
        rootIndex: 0,
        rootCount: 1,
        completedRoots: 0,
        terminal: { presence: "present", executionSuccessful: false },
      },
    },
    roots: [{ runtimeErrors: { classes: { RateLimitError: 1 }, unknownClasses: 0 } }],
  });
  expect(await readdir(join(root, "temp"))).toEqual([output.split("/").at(-1)]);
  expect(process.exitCode).toBe(1);
});

it("rejects a changed original before invoking any model and still cleans up", async () => {
  const root = await setup(true);
  await main([]);
  expect(probe.calls).toBe(0);
  const output = (await readFile(join(root, "output"), "utf8")).trim().split("=")[1];
  expect(JSON.parse(await readFile(join(output, "summary.json"), "utf8"))).toMatchObject({
    status: "validation_failed",
    validationFailed: true,
    cleanup: true,
  });
});

it("rejects a scanner checkout that differs from the adopted production pin before any model", async () => {
  const root = await setup();
  probe.scannerCommit = "0".repeat(40);
  await main([]);
  expect(probe.calls).toBe(0);
  const output = (await readFile(join(root, "output"), "utf8")).trim().split("=")[1];
  expect(JSON.parse(await readFile(join(output, "summary.json"), "utf8"))).toMatchObject({
    status: "validation_failed",
    validationFailed: true,
    cleanup: true,
  });
});
