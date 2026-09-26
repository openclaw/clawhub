/* @vitest-environment node */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { createConvexCliClient, processFailureClass } from "./plugin-category-operator";

afterEach(() => vi.unstubAllEnvs());

describe("native Convex CLI deployment-key selection", () => {
  it("reproduces the named-selector login path and keeps every adapter operation on key resolution", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    // No deployment credentials or cloud service are involved. Stop every
    // request at this loopback provision service before a backend can be used.
    const server = createServer((request, response) => {
      requests.push({ method: request.method ?? "", path: request.url ?? "" });
      request.resume();
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "FixtureDenied", message: "Fixture request stopped." }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback fixture unavailable");
    vi.stubEnv("CONVEX_PROVISION_HOST", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("CONVEX_DEPLOY_KEY", "prod:operator-fixture-123|not-a-real-key");
    vi.stubEnv("CONVEX_DEPLOYMENT", undefined);
    vi.stubEnv("CONVEX_OVERRIDE_ACCESS_TOKEN", undefined);
    vi.stubEnv("CONVEX_SELF_HOSTED_URL", undefined);
    vi.stubEnv("CONVEX_SELF_HOSTED_ADMIN_KEY", undefined);
    vi.stubEnv("CI", "1");
    try {
      await expect(
        promisify(execFile)(
          "node",
          [
            "node_modules/convex/bin/main.js",
            "run",
            "--codegen",
            "disable",
            "appMeta:getDeploymentInfo",
            "{}",
            "--deployment",
            "operator-fixture-123",
          ],
          { timeout: 10_000 },
        ),
      ).rejects.toMatchObject({ code: 1 });
      expect(requests[0]).toEqual({
        method: "GET",
        path: "/api/deployment/operator-fixture-123/team_and_project",
      });

      const client = createConvexCliClient();
      const probes = [
        ["appMeta:getDeploymentInfo", () => client.run("appMeta:getDeploymentInfo", {})],
        ["lib:getStatus", () => client.run("lib:getStatus", { names: [] }, true)],
        ["journal-query", () => client.query("return []; ")],
        ["environment-names", () => client.envNames()],
        ["category-model", () => client.model()],
      ] as const;
      for (const [operation, run] of probes) {
        requests.length = 0;
        await expect(run()).rejects.toThrow(`Convex ${operation} failed (exit-1)`);
        expect(requests[0]).toEqual({ method: "POST", path: "/api/deployment/url_for_key" });
        expect(requests.some((request) => request.path.includes("team_and_project"))).toBe(false);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 30_000);

  it("classifies process failures without disclosing stderr, stdout, arguments, or arbitrary codes", () => {
    const privateFields = {
      stderr: "credential=DO_NOT_PRINT",
      stdout: "raw source",
      message: "private command args",
    };
    expect(processFailureClass({ ...privateFields, code: 1 })).toBe("exit-1");
    expect(processFailureClass({ ...privateFields, code: "ENOENT" })).toBe("executable-missing");
    expect(processFailureClass({ ...privateFields, code: "EACCES" })).toBe("executable-denied");
    expect(
      processFailureClass({ ...privateFields, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
    ).toBe("output-limit");
    expect(processFailureClass({ ...privateFields, killed: true })).toBe("timeout");
    expect(processFailureClass({ ...privateFields, code: "DO_NOT_PRINT" })).toBe("process-error");
    expect(processFailureClass(null)).toBe("process-error");
  });
});

describe("category refresh source revision", () => {
  it.each([
    { name: "resumes the deployed main ancestor", expected: "deployed", succeeds: true },
    { name: "accepts the current main revision", expected: "dispatch", succeeds: true },
    { name: "rejects an unrelated commit", expected: "unrelated", succeeds: false },
    {
      name: "rejects a mismatched detached checkout",
      expected: "deployed",
      wrongCheckout: true,
      succeeds: false,
    },
    {
      name: "rejects non-main dispatch",
      expected: "deployed",
      ref: "refs/heads/codex/task",
      succeeds: false,
    },
    { name: "rejects an invalid requested SHA", expected: "invalid", succeeds: false },
  ])("$name through native workflow and operator guards", async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), "category-refresh-git-"));
    const execute = promisify(execFile);
    const git = (...args: string[]) => execute("git", args, { cwd: directory });
    const commit = async (message: string) => {
      await git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        message,
      );
      return (await git("rev-parse", "HEAD")).stdout.trim();
    };
    try {
      await git("init", "-b", "main");
      const deployed = await commit("deployed source");
      const dispatch = await commit("unrelated main work");
      await git("checkout", "--orphan", "unrelated");
      const unrelated = await commit("unmerged source");
      const revisions: Record<string, string> = {
        deployed,
        dispatch,
        unrelated,
        invalid: "invalid; revision",
      };
      const expected = revisions[scenario.expected];
      const env = {
        ...process.env,
        GITHUB_REF: scenario.ref ?? "refs/heads/main",
        GITHUB_SHA: dispatch,
        CATEGORY_EXPECTED_SHA: expected,
      };
      const workflow = parseYaml(
        await readFile(".github/workflows/plugin-category-refresh.yml", "utf8"),
      ) as {
        jobs: {
          operate: {
            environment: { name: string };
            steps: Array<{
              run?: string;
              uses?: string;
              env?: Record<string, unknown>;
              with?: Record<string, unknown>;
            }>;
          };
        };
      };
      expect(workflow.jobs.operate.environment.name).toBe("Production");
      expect(
        workflow.jobs.operate.steps.find(
          (step) => step.run === "bun scripts/plugin-category-operator.ts",
        )?.env,
      ).toHaveProperty("CATEGORY_PACKAGE_NAMES", "${{ inputs.package_names }}");
      const preflight = async () => {
        for (const step of workflow.jobs.operate.steps) {
          // Exercise every real guard before the first checked-out action. A
          // guard moved after setup must no longer protect these rejection cases.
          if (step.uses?.startsWith("./")) break;
          expect(step.env ?? {}).not.toHaveProperty("CONVEX_DEPLOY_KEY");
          if (step.uses?.startsWith("actions/checkout@")) {
            expect(step.with).toMatchObject({ "fetch-depth": 0, "persist-credentials": false });
            const ref = step.with?.ref === "${{ inputs.expected_sha }}" ? expected : dispatch;
            await git("checkout", "--detach", scenario.wrongCheckout ? dispatch : ref);
          } else if (step.run) {
            await execute("bash", ["-c", step.run], { cwd: directory, env });
          }
        }
      };
      if (scenario.succeeds) {
        await preflight();
        expect((await git("rev-parse", "HEAD")).stdout.trim()).toBe(expected);
      } else {
        await expect(preflight()).rejects.toMatchObject({ code: 1 });
      }
      // Independently invoke the runtime parser in the actual fixture checkout;
      // no mocked Git output or caller-provided checkout identity is involved.
      await git(
        "checkout",
        "--detach",
        scenario.wrongCheckout || scenario.expected === "invalid" ? dispatch : expected,
      );
      const operator = resolve("scripts/plugin-category-operator.ts");
      const parsed = execute(
        "bun",
        [
          "-e",
          `import { parseOptions } from ${JSON.stringify(operator)}; console.log(parseOptions(process.env).sha);`,
        ],
        {
          cwd: directory,
          env: {
            ...env,
            CONVEX_DEPLOY_KEY: "prod:wry-manatee-359|test-only",
            CATEGORY_MODE: "status",
            CATEGORY_RUN_ID: "resume-proof",
          },
        },
      );
      if (scenario.succeeds) {
        expect((await parsed).stdout.trim()).toBe(expected);
      } else {
        await expect(parsed).rejects.toMatchObject({ code: 1 });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
