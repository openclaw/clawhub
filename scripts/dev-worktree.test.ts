import { describe, expect, it } from "vitest";
import {
  applyLocalDevWorkerToken,
  buildLocalConvexEnvChanges,
  buildDevWorkersArgs,
  buildForegroundArgs,
  buildEnvFileCandidates,
  buildViteArgs,
  isConvexFunctionUnavailableOutput,
  isLocalConvexUrl,
  isRunningPid,
  parseArgs,
  parseEnv,
  shouldStartDevWorkers,
} from "./dev-worktree";

describe("dev-worktree helpers", () => {
  it("parses env files without treating inline comments as values", () => {
    expect(
      parseEnv(`
        CONVEX_DEPLOYMENT=local:local-amantus-clawdhub # team: amantus, project: clawdhub
        SITE_URL=http://localhost:3000
        HASH_VALUE=abc#123
        QUOTED_HASH="value # kept"
      `),
    ).toEqual({
      CONVEX_DEPLOYMENT: "local:local-amantus-clawdhub",
      SITE_URL: "http://localhost:3000",
      HASH_VALUE: "abc#123",
      QUOTED_HASH: "value # kept",
    });
  });

  it("uses only the local checkout env unless an env file is explicit", () => {
    expect(
      buildEnvFileCandidates({
        explicit: null,
        cwd: "/tmp/worktrees/feature",
        worktrees: [
          "/Users/me/Git/openclaw/clawhub",
          "/tmp/worktrees/feature",
          "/tmp/worktrees/other-feature",
        ],
      }),
    ).toEqual([".env.local"]);
  });

  it("keeps explicit env files authoritative", () => {
    expect(
      buildEnvFileCandidates({
        explicit: "/secure/shared.env",
        cwd: "/tmp/worktrees/feature",
        worktrees: ["/Users/me/Git/openclaw/clawhub"],
      }),
    ).toEqual(["/secure/shared.env"]);
  });

  it("recognizes Convex functions that are not queryable yet", () => {
    expect(
      isConvexFunctionUnavailableOutput(`
        Failed to run function "devSeed:seedLocalFixtures":
        Could not find function for 'devSeed:seedLocalFixtures'. Did you forget to run \`npx convex dev\`?
        No functions found.
      `),
    ).toBe(true);

    expect(isConvexFunctionUnavailableOutput("AUTH_GITHUB_ID is required")).toBe(false);
  });

  it("parses detach mode for Codex setup startup", () => {
    expect(parseArgs(["--detach", "--port", "3999"])).toMatchObject({
      detach: true,
      port: "3999",
      workers: true,
    });
  });

  it("allows local background workers to be disabled explicitly", () => {
    expect(parseArgs(["--no-workers"])).toMatchObject({
      workers: false,
    });
  });

  it("does not pass detach mode to the foreground child process", () => {
    expect(buildForegroundArgs(["--detach", "--port", "3999"])).toEqual(["--port", "3999"]);
  });

  it("binds Vite to the same loopback host advertised by Worktrunk", () => {
    expect(buildViteArgs("3999")).toEqual([
      "--bun",
      "vite",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      "3999",
    ]);
  });

  it("starts dev workers with the same env file as the app", () => {
    expect(buildDevWorkersArgs("/tmp/clawhub/.env.local")).toEqual([
      "scripts/dev-workers.ts",
      "--env-file",
      "/tmp/clawhub/.env.local",
    ]);
  });

  it("overrides the shared worker token with a fixed local-dev value", () => {
    const env: NodeJS.ProcessEnv = { SECURITY_SCAN_WORKER_TOKEN: "prod-like-token" };

    expect(applyLocalDevWorkerToken(env)).toBe("local-dev-worker-token");
    expect(env.SECURITY_SCAN_WORKER_TOKEN).toBe("local-dev-worker-token");
  });

  it("builds local Convex env for dev auth without overriding built-ins", () => {
    const changes = buildLocalConvexEnvChanges({
      CONVEX_DEPLOYMENT: "anonymous:anonymous-agent",
      CONVEX_SITE_URL: "http://127.0.0.1:3211",
    });
    const byName = Object.fromEntries(changes.map((change) => [change.name, change.value]));

    expect(byName.DEV_AUTH_ENABLED).toBe("1");
    expect(byName.DEV_AUTH_CONVEX_DEPLOYMENT).toBe("anonymous:anonymous-agent");
    expect(byName.SECURITY_SCAN_WORKER_TOKEN).toBe("local-dev-worker-token");
    expect(byName.SECURITY_SCAN_DEFAULT_VT_WAIT_MS).toBe("0");
    expect(byName.AUTH_GITHUB_ID).toBe("local-dev");
    expect(byName.AUTH_GITHUB_SECRET).toBe("local-dev");
    expect(byName.JWT_PRIVATE_KEY).toContain("BEGIN PRIVATE KEY");
    expect(JSON.parse(byName.JWKS)).toMatchObject({
      keys: [expect.objectContaining({ use: "sig" })],
    });
    expect(byName.CONVEX_SITE_URL).toBeUndefined();
  });

  it("recognizes local Convex URLs", () => {
    expect(isLocalConvexUrl("http://127.0.0.1:3210")).toBe(true);
    expect(isLocalConvexUrl("http://localhost:3210")).toBe(true);
    expect(isLocalConvexUrl("https://example.convex.cloud")).toBe(false);
    expect(isLocalConvexUrl("not-a-url")).toBe(false);
  });

  it("starts dev workers by default unless disabled", () => {
    expect(shouldStartDevWorkers({ workers: true })).toEqual({ start: true, reason: null });

    expect(shouldStartDevWorkers({ workers: false })).toEqual({
      start: false,
      reason: "--no-workers was passed",
    });
  });

  it("treats invalid detached pid file values as not running", () => {
    expect(isRunningPid(null)).toBe(false);
    expect(isRunningPid(0)).toBe(false);
    expect(isRunningPid(Number.NaN)).toBe(false);
    expect(isRunningPid(process.pid)).toBe(true);
  });
});
