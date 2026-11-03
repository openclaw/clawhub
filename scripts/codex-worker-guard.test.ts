/* @vitest-environment node */

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  assertCodexWorkerExecutionAllowed,
  isCodexWorkerExecutionAllowed,
  LOCAL_CODEX_WORKER_OPT_IN,
  resolveCodexWorkerHome,
} from "./codex-worker-guard";

const exec = promisify(execFile);

describe("Codex worker admission", () => {
  it("blocks direct local Codex worker runs without opt-in", () => {
    expect(isCodexWorkerExecutionAllowed({})).toBe(false);
    expect(() => assertCodexWorkerExecutionAllowed({})).toThrow(
      `Refusing to run local Codex workers without ${LOCAL_CODEX_WORKER_OPT_IN}=1`,
    );
  });

  it("does not treat a bare GITHUB_ACTIONS flag as CI authorization", () => {
    expect(isCodexWorkerExecutionAllowed({ GITHUB_ACTIONS: "true" })).toBe(false);
    expect(() => assertCodexWorkerExecutionAllowed({ GITHUB_ACTIONS: "true" })).toThrow(
      `Refusing to run local Codex workers without ${LOCAL_CODEX_WORKER_OPT_IN}=1`,
    );
  });

  it("allows direct Codex worker runs in GitHub Actions", () => {
    const env = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "openclaw/clawhub",
      GITHUB_RUN_ID: "123",
    };

    expect(isCodexWorkerExecutionAllowed(env)).toBe(true);
    expect(() => assertCodexWorkerExecutionAllowed(env)).not.toThrow();
  });

  it("allows direct local Codex worker runs with explicit opt-in", () => {
    expect(isCodexWorkerExecutionAllowed({ [LOCAL_CODEX_WORKER_OPT_IN]: "1" })).toBe(true);
    expect(() =>
      assertCodexWorkerExecutionAllowed({ [LOCAL_CODEX_WORKER_OPT_IN]: "1" }),
    ).not.toThrow();
  });

  it("uses an isolated local Codex home for opted-in local workers by default", () => {
    expect(
      resolveCodexWorkerHome(
        { [LOCAL_CODEX_WORKER_OPT_IN]: "1" },
        "/repo/.codex/runtime/codex-workers/security-scan",
      ),
    ).toBe("/repo/.codex/runtime/codex-workers/security-scan");
    expect(
      resolveCodexWorkerHome(
        { [LOCAL_CODEX_WORKER_OPT_IN]: "1", CODEX_HOME: "/tmp/custom-codex-home" },
        "/repo/.codex/runtime/codex-workers/security-scan",
      ),
    ).toBe("/tmp/custom-codex-home");
  });

  it.each(["security/run-codex-scan-worker.ts", "skill-cards/run-skill-card-worker.ts"])(
    "refuses the real %s entrypoint before backend access",
    async (script) => {
      const scratch = await mkdtemp(join(tmpdir(), "clawhub-worker-admission-"));
      const requests: string[] = [];
      const server = createServer((request, response) => {
        requests.push(request.url ?? "");
        request.resume();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "success", value: [] }));
      });
      try {
        await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing fixture port");
        await expect(
          exec("bun", [fileURLToPath(new URL(script, import.meta.url)), "--max-jobs", "1"], {
            cwd: scratch,
            timeout: 10_000,
            env: {
              PATH: process.env.PATH,
              CONVEX_URL: `http://127.0.0.1:${address.port}`,
              SECURITY_SCAN_WORKER_TOKEN: "fixture-token",
            },
          }),
        ).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining(
            `Refusing to run local Codex workers without ${LOCAL_CODEX_WORKER_OPT_IN}=1`,
          ),
        });
        expect(requests).toEqual([]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
        await rm(scratch, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
