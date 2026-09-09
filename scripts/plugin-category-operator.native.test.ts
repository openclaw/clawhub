/* @vitest-environment node */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
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
